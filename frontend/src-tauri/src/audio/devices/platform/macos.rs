use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};

use crate::audio::capture::{get_current_backend, AudioCaptureBackend};
use crate::audio::devices::configuration::{
    AudioDevice,
    DeviceType,
    is_macos_system_capture_input,
};

/// Configure macOS audio devices for the currently selected backend.
pub fn configure_macos_audio(host: &cpal::Host) -> Result<Vec<AudioDevice>> {
    let mut devices: Vec<AudioDevice> = Vec::new();
    let backend = get_current_backend();

    for device in host.input_devices()? {
        if let Ok(name) = device.name() {
            devices.push(AudioDevice::new(name, DeviceType::Input));
        }
    }

    match backend {
        AudioCaptureBackend::ScreenCaptureKit => {
            // In the current macOS path, "ScreenCaptureKit" mode can only use
            // loopback-style capture inputs surfaced as system-audio sources.
            for device in host.input_devices()? {
                if let Ok(name) = device.name() {
                    if is_macos_system_capture_input(&name)
                        && !devices.iter().any(|existing| {
                            existing.name == name && existing.device_type == DeviceType::Output
                        })
                    {
                        devices.push(AudioDevice::new(name, DeviceType::Output));
                    }
                }
            }
        }
        AudioCaptureBackend::CoreAudio => {
            // Core Audio taps can target the selected playback output directly.
            for device in host.output_devices()? {
                if let Ok(name) = device.name() {
                    if !devices.iter().any(|existing| {
                        existing.name == name && existing.device_type == DeviceType::Output
                    }) {
                        devices.push(AudioDevice::new(name, DeviceType::Output));
                    }
                }
            }
        }
    }

    Ok(devices)
}
