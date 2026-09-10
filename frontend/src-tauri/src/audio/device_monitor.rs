// Audio device monitoring for disconnect/reconnect detection
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use anyhow::Result;
use log::{debug, info, warn, error};

use super::devices::{AudioDevice, list_audio_devices};

/// Device monitoring events
#[derive(Debug, Clone)]
pub enum DeviceEvent {
    /// A device that was in use has disconnected
    DeviceDisconnected {
        device_name: String,
        device_type: DeviceMonitorType,
    },
    /// A previously disconnected device has reconnected
    DeviceReconnected {
        device_name: String,
        device_type: DeviceMonitorType,
    },
    /// Device list has changed (new device added or removed)
    DeviceListChanged,
}

/// Type of device being monitored
#[derive(Debug, Clone, PartialEq)]
pub enum DeviceMonitorType {
    Microphone,
    SystemAudio,
}

/// Monitor state for a single device
#[derive(Debug, Clone)]
struct MonitoredDevice {
    name: String,
    device_type: DeviceMonitorType,
    consecutive_missing: u32,
    is_bluetooth: bool,
}

impl MonitoredDevice {
    fn new(name: String, device_type: DeviceMonitorType) -> Self {
        // Heuristic: check if device name contains bluetooth-related keywords
        let is_bluetooth = name.to_lowercase().contains("airpods")
            || name.to_lowercase().contains("bluetooth")
            || name.to_lowercase().contains("wireless");

        Self {
            name,
            device_type,
            consecutive_missing: 0,
            is_bluetooth,
        }
    }

    /// Get appropriate disconnect threshold based on device type
    fn disconnect_threshold(&self) -> u32 {
        // Bluetooth devices get more grace period (they can briefly disconnect)
        if self.is_bluetooth {
            3 // 3 polling cycles (6-15 seconds)
        } else {
            2 // 2 polling cycles (4-10 seconds)
        }
    }

    /// Get appropriate reconnect check interval
    #[allow(dead_code)]
    fn reconnect_interval(&self) -> Duration {
        if self.is_bluetooth {
            Duration::from_secs(5) // Check every 5s for Bluetooth
        } else {
            Duration::from_secs(3) // Check every 3s for wired devices
        }
    }
}

/// Audio device monitor that detects disconnects and reconnects
pub struct AudioDeviceMonitor {
    monitor_handle: Option<JoinHandle<()>>,
    event_sender: mpsc::UnboundedSender<DeviceEvent>,
    stop_signal: Arc<tokio::sync::Notify>,
}

impl AudioDeviceMonitor {
    /// Create a new device monitor
    pub fn new() -> (Self, mpsc::UnboundedReceiver<DeviceEvent>) {
        let (event_sender, event_receiver) = mpsc::unbounded_channel();
        let stop_signal = Arc::new(tokio::sync::Notify::new());

        (
            Self {
                monitor_handle: None,
                event_sender,
                stop_signal,
            },
            event_receiver,
        )
    }

    /// Start monitoring specified devices
    pub fn start_monitoring(
        &mut self,
        microphone: Option<Arc<AudioDevice>>,
        system_audio: Option<Arc<AudioDevice>>,
    ) -> Result<()> {
        if self.monitor_handle.is_some() {
            warn!("Device monitor already running");
            return Ok(());
        }

        let mut monitored_devices = Vec::new();

        if let Some(mic) = microphone {
            monitored_devices.push(MonitoredDevice::new(
                mic.name.clone(),
                DeviceMonitorType::Microphone,
            ));
            info!("🔍 Monitoring microphone: '{}' (Bluetooth: {})",
                  mic.name, monitored_devices.last().unwrap().is_bluetooth);
        }

        if let Some(sys) = system_audio {
            monitored_devices.push(MonitoredDevice::new(
                sys.name.clone(),
                DeviceMonitorType::SystemAudio,
            ));
            info!("🔍 Monitoring system audio: '{}' (Bluetooth: {})",
                  sys.name, monitored_devices.last().unwrap().is_bluetooth);
        }

        if monitored_devices.is_empty() {
            return Err(anyhow::anyhow!("No devices to monitor"));
        }

        let event_sender = self.event_sender.clone();
        let stop_signal = self.stop_signal.clone();

        let handle = tokio::spawn(async move {
            Self::monitor_loop(monitored_devices, event_sender, stop_signal).await;
        });

        self.monitor_handle = Some(handle);
        info!("✅ Device monitor started");
        Ok(())
    }

    /// Stop monitoring
    pub async fn stop_monitoring(&mut self) {
        info!("Stopping device monitor");
        if let Some(handle) = self.monitor_handle.take() {
            self.stop_signal.notify_one();
            let _ = handle.await;
        }

        info!("Device monitor stopped");
    }

    /// Main monitoring loop
    async fn monitor_loop(
        monitored_devices: Vec<MonitoredDevice>,
        event_sender: mpsc::UnboundedSender<DeviceEvent>,
        stop_signal: Arc<tokio::sync::Notify>,
    ) {
        Self::monitor_loop_with_enumerator(
            monitored_devices, event_sender, stop_signal, list_audio_devices,
        ).await;
    }

    async fn monitor_loop_with_enumerator<F, Fut>(
        mut monitored_devices: Vec<MonitoredDevice>,
        event_sender: mpsc::UnboundedSender<DeviceEvent>,
        stop_signal: Arc<tokio::sync::Notify>,
        mut enumerate: F,
    ) where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<Vec<AudioDevice>>>,
    {
        let mut last_device_list = Vec::new();
        let mut check_interval = Duration::from_secs(2);

        loop {
            // Check for stop signal with timeout
            tokio::select! {
                _ = stop_signal.notified() => {
                    info!("Device monitor received stop signal");
                    break;
                }
                _ = tokio::time::sleep(check_interval) => {
                    // Continue with monitoring check
                }
            }

            // Get current device list
            // Stop does not need a device inventory. An already-running native
            // probe may finish on its blocking thread, but cannot emit late events.
            let result = tokio::select! {
                biased;
                _ = stop_signal.notified() => break,
                result = enumerate() => result,
            };
            let current_devices = match result {
                Ok(devices) => devices,
                Err(e) => {
                    error!("Failed to list audio devices: {}", e);
                    continue;
                }
            };

            // Check if device list changed
            if current_devices.len() != last_device_list.len() {
                debug!("Device list changed: {} -> {} devices",
                       last_device_list.len(), current_devices.len());
                let _ = event_sender.send(DeviceEvent::DeviceListChanged);
            }
            last_device_list = current_devices.clone();

            // Check each monitored device
            for monitored in &mut monitored_devices {
                let device_found = current_devices.iter().any(|d| d.name == monitored.name);

                if device_found {
                    // Device is present
                    if monitored.consecutive_missing > 0 {
                        // Device has reconnected!
                        info!("✅ Device '{}' reconnected after {} missing checks",
                              monitored.name, monitored.consecutive_missing);

                        let _ = event_sender.send(DeviceEvent::DeviceReconnected {
                            device_name: monitored.name.clone(),
                            device_type: monitored.device_type.clone(),
                        });

                        monitored.consecutive_missing = 0;
                    }
                } else {
                    // Device is missing
                    monitored.consecutive_missing += 1;

                    debug!("⚠️ Device '{}' missing for {} checks (threshold: {})",
                          monitored.name, monitored.consecutive_missing,
                          monitored.disconnect_threshold());

                    // Only emit disconnect event once when threshold is reached
                    if monitored.consecutive_missing == monitored.disconnect_threshold() {
                        warn!("❌ Device '{}' ({:?}) disconnected!",
                              monitored.name, monitored.device_type);

                        let _ = event_sender.send(DeviceEvent::DeviceDisconnected {
                            device_name: monitored.name.clone(),
                            device_type: monitored.device_type.clone(),
                        });
                    }
                }
            }

            // Adjust check interval based on device states
            // If any device is missing, check more frequently
            let has_missing = monitored_devices.iter().any(|d| d.consecutive_missing > 0);
            let next_interval = if has_missing {
                Duration::from_secs(2) // Fast polling when device missing
            } else {
                Duration::from_secs(5) // Slower polling when all devices present
            };

            if next_interval != check_interval {
                debug!("Adjusting monitor interval to {:?}", next_interval);
            }
            check_interval = next_interval;
        }
    }
}

impl Default for AudioDeviceMonitor {
    fn default() -> Self {
        Self::new().0
    }
}

impl Drop for AudioDeviceMonitor {
    fn drop(&mut self) {
        // Signal stop
        self.stop_signal.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bluetooth_detection() {
        let airpods = MonitoredDevice::new(
            "John's AirPods Pro".to_string(),
            DeviceMonitorType::Microphone,
        );
        assert!(airpods.is_bluetooth);
        assert_eq!(airpods.disconnect_threshold(), 3);

        let builtin = MonitoredDevice::new(
            "Built-in Microphone".to_string(),
            DeviceMonitorType::Microphone,
        );
        assert!(!builtin.is_bluetooth);
        assert_eq!(builtin.disconnect_threshold(), 2);
    }

    #[tokio::test]
    async fn test_monitor_creation() {
        let (mut monitor, _receiver) = AudioDeviceMonitor::new();
        assert!(monitor.monitor_handle.is_none());

        // Stop should be safe even if not started
        monitor.stop_monitoring().await;
    }

    #[tokio::test(start_paused = true)]
    async fn polling_slows_when_present_and_accelerates_when_missing() {
        use super::super::devices::DeviceType;
        use std::sync::atomic::{AtomicBool, Ordering};

        let present = Arc::new(AtomicBool::new(true));
        let enumerated_present = present.clone();
        let (events, mut received_events) = mpsc::unbounded_channel();
        let (polls, mut received_polls) = mpsc::unbounded_channel();
        let stop = Arc::new(tokio::sync::Notify::new());
        let task = tokio::spawn(AudioDeviceMonitor::monitor_loop_with_enumerator(
            vec![MonitoredDevice::new("Test mic".into(), DeviceMonitorType::Microphone)],
            events,
            stop.clone(),
            move || {
                polls.send(()).unwrap();
                let devices = if enumerated_present.load(Ordering::SeqCst) {
                    vec![AudioDevice::new("Test mic".into(), DeviceType::Input)]
                } else {
                    Vec::new()
                };
                std::future::ready(Ok(devices))
            },
        ));
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(2)).await;
        tokio::task::yield_now().await;
        assert!(received_polls.try_recv().is_ok());
        assert!(matches!(received_events.try_recv(), Ok(DeviceEvent::DeviceListChanged)));
        tokio::time::advance(Duration::from_secs(4)).await;
        tokio::task::yield_now().await;
        assert!(received_polls.try_recv().is_err(), "healthy devices must not be polled every two seconds");
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert!(received_polls.try_recv().is_ok());
        present.store(false, Ordering::SeqCst);
        tokio::time::advance(Duration::from_secs(5)).await;
        tokio::task::yield_now().await;
        assert!(received_polls.try_recv().is_ok());
        assert!(matches!(received_events.try_recv(), Ok(DeviceEvent::DeviceListChanged)));
        assert!(received_events.try_recv().is_err(), "one missed poll must not report disconnection");
        tokio::time::advance(Duration::from_secs(2)).await;
        tokio::task::yield_now().await;
        assert!(received_polls.try_recv().is_ok());
        assert!(matches!(received_events.try_recv(), Ok(DeviceEvent::DeviceDisconnected { .. })));
        stop.notify_one();
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn stop_during_device_discovery_does_not_wait_or_emit_events() {
        let (events, mut received_events) = mpsc::unbounded_channel();
        let (polls, mut received_polls) = mpsc::unbounded_channel();
        let stop = Arc::new(tokio::sync::Notify::new());
        let task = tokio::spawn(AudioDeviceMonitor::monitor_loop_with_enumerator(
            vec![MonitoredDevice::new("Test mic".into(), DeviceMonitorType::Microphone)],
            events,
            stop.clone(),
            move || {
                polls.send(()).unwrap();
                std::future::pending::<Result<Vec<AudioDevice>>>()
            },
        ));
        received_polls.recv().await.unwrap();
        stop.notify_one();
        tokio::time::timeout(Duration::from_secs(1), task).await.unwrap().unwrap();
        assert!(received_events.try_recv().is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn stopping_an_idle_monitor_does_not_cancel_its_next_start() {
        let (mut monitor, _) = AudioDeviceMonitor::new();
        monitor.stop_monitoring().await;
        assert!(tokio::time::timeout(
            Duration::from_millis(1), monitor.stop_signal.notified(),
        ).await.is_err());
    }
}
