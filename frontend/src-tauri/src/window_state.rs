//! Clamp persisted main-window frames to visible displays.
//!
//! Size is physical inner pixels; position is physical outer origin. Overlay
//! title bars keep those two coordinate spaces distinct.

const MIN_LOGICAL_WIDTH: f64 = 600.0;
const MIN_LOGICAL_HEIGHT: f64 = 400.0;
const DEFAULT_LOGICAL_WIDTH: f64 = 1400.0;
const DEFAULT_LOGICAL_HEIGHT: f64 = 1000.0;
const MIN_VISIBLE_FRACTION: f64 = 0.25;
const TITLE_BAR_LOGICAL_HEIGHT: f64 = 28.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

impl MonitorBounds {
    fn right(self) -> i32 {
        self.x.saturating_add(self.width as i32)
    }

    fn bottom(self) -> i32 {
        self.y.saturating_add(self.height as i32)
    }

    pub fn contains_point(self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }

    fn intersection_area(self, x: i32, y: i32, width: u32, height: u32) -> u64 {
        let left = x.max(self.x);
        let top = y.max(self.y);
        let right = x.saturating_add(width as i32).min(self.right());
        let bottom = y.saturating_add(height as i32).min(self.bottom());
        let w = (right - left).max(0) as u64;
        let h = (bottom - top).max(0) as u64;
        w.saturating_mul(h)
    }

    fn distance_sq_to_point(self, x: i32, y: i32) -> i64 {
        let clamped_x = x.clamp(self.x, self.right().saturating_sub(1));
        let clamped_y = y.clamp(self.y, self.bottom().saturating_sub(1));
        let dx = (x - clamped_x) as i64;
        let dy = (y - clamped_y) as i64;
        dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy))
    }

    fn min_physical_size(self) -> (u32, u32) {
        let scale = if self.scale_factor.is_finite() && self.scale_factor > 0.0 {
            self.scale_factor
        } else {
            1.0
        };
        let min_w = (MIN_LOGICAL_WIDTH * scale).round().clamp(1.0, self.width.max(1) as f64) as u32;
        let min_h = (MIN_LOGICAL_HEIGHT * scale).round().clamp(1.0, self.height.max(1) as f64) as u32;
        (min_w.min(self.width.max(1)), min_h.min(self.height.max(1)))
    }

    fn default_physical_size(self) -> (u32, u32) {
        let scale = if self.scale_factor.is_finite() && self.scale_factor > 0.0 {
            self.scale_factor
        } else {
            1.0
        };
        let (min_w, min_h) = self.min_physical_size();
        let max_w = self.width.max(1);
        let max_h = self.height.max(1);
        let mut width = (DEFAULT_LOGICAL_WIDTH * scale)
            .round()
            .clamp(min_w as f64, max_w as f64) as u32;
        let mut height = (DEFAULT_LOGICAL_HEIGHT * scale)
            .round()
            .clamp(min_h as f64, max_h as f64) as u32;
        // Never land a corrected restore at 100% of the monitor (looks maximized).
        if width == max_w && height == max_h && (max_w > min_w || max_h > min_h) {
            width = ((max_w as f64) * 0.85).round().clamp(min_w as f64, max_w as f64) as u32;
            height = ((max_h as f64) * 0.85).round().clamp(min_h as f64, max_h as f64) as u32;
        }
        (width, height)
    }

    fn title_bar_height(self) -> u32 {
        let scale = if self.scale_factor.is_finite() && self.scale_factor > 0.0 {
            self.scale_factor
        } else {
            1.0
        };
        (TITLE_BAR_LOGICAL_HEIGHT * scale)
            .round()
            .clamp(1.0, self.height.max(1) as f64) as u32
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowFrame {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

pub fn sanitize_restored_frame(
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
    monitors: &[MonitorBounds],
    primary: Option<MonitorBounds>,
) -> Option<WindowFrame> {
    if monitors.is_empty() {
        return None;
    }

    let primary = primary
        .filter(|monitor| monitor.width > 0 && monitor.height > 0)
        .or_else(|| monitors.iter().copied().find(|monitor| monitor.width > 0 && monitor.height > 0))?;

    let saved_origin = match (finite_coord(x), finite_coord(y)) {
        (Some(origin_x), Some(origin_y)) => Some((origin_x, origin_y)),
        _ => None,
    };

    let raw_width = finite_positive(width);
    let raw_height = finite_positive(height);
    let (probe_w, probe_h) = match (raw_width, raw_height) {
        (Some(w), Some(h)) => (clamp_f64_to_u32(w).max(1), clamp_f64_to_u32(h).max(1)),
        _ => primary.min_physical_size(),
    };

    let (probe_x, probe_y) = saved_origin.unwrap_or((primary.x, primary.y));
    let origin_on_a_display = monitors.iter().any(|monitor| monitor.contains_point(probe_x, probe_y));
    let intersecting = visible_area(probe_x, probe_y, probe_w, probe_h, monitors);
    let window_area = (probe_w as u64).saturating_mul(probe_h as u64);
    let visible_fraction = if window_area == 0 {
        0.0
    } else {
        intersecting as f64 / window_area as f64
    };
    // Missing origin → fall back to primary defaults.
    // A known origin that is currently off every enumerated display (common
    // when a secondary monitor is not ready yet, or the saved frame is taller
    // than the side display work area) still targets the nearest display and
    // clamps there — never recenter on primary solely because height needs a
    // clamp.
    let missing_origin = saved_origin.is_none();
    let origin_off_displays =
        !missing_origin && !origin_on_a_display && visible_fraction < MIN_VISIBLE_FRACTION;

    let target = if missing_origin {
        primary
    } else if origin_off_displays {
        nearest_monitor(probe_x, probe_y, monitors).unwrap_or(primary)
    } else {
        select_target_monitor(probe_x, probe_y, probe_w, probe_h, monitors).unwrap_or(primary)
    };

    let (width, height) = if missing_origin {
        // Missing-origin restores use a sane default, never full-monitor.
        target.default_physical_size()
    } else {
        // Known origin (on-display or nearest): keep saved size clamped to that
        // monitor. Height taller than a side display must stay on that display.
        let (width, height) = clamp_size_to_monitor(raw_width, raw_height, target);
        // Oversized junk that fills the whole monitor after clamp would look
        // maximized; use defaults for size only, still keep placement below.
        if width == target.width && height == target.height {
            target.default_physical_size()
        } else {
            (width, height)
        }
    };
    let (x, y) = if missing_origin {
        center_on_monitor(width, height, target)
    } else {
        clamp_position_to_monitor(probe_x, probe_y, width, height, target)
    };

    Some(WindowFrame {
        width,
        height,
        x,
        y,
    })
}

pub fn frame_is_persistable(
    width: u32,
    height: u32,
    x: Option<i32>,
    y: Option<i32>,
    maximized: bool,
    monitors: &[MonitorBounds],
) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    if monitors.is_empty() {
        return true;
    }
    if maximized {
        return true;
    }

    let max_width = monitors.iter().map(|monitor| monitor.width).max().unwrap_or(0);
    let max_height = monitors.iter().map(|monitor| monitor.height).max().unwrap_or(0);
    if width > max_width || height > max_height {
        return false;
    }

    match (x, y) {
        (Some(origin_x), Some(origin_y)) => {
            title_bar_is_visible(origin_x, origin_y, width, monitors)
                || visible_fraction(origin_x, origin_y, width, height, monitors) >= MIN_VISIBLE_FRACTION
        }
        _ => true,
    }
}

pub fn frame_needs_correction(frame: WindowFrame, monitors: &[MonitorBounds]) -> bool {
    if monitors.is_empty() {
        return false;
    }
    !frame_is_persistable(
        frame.width,
        frame.height,
        Some(frame.x),
        Some(frame.y),
        false,
        monitors,
    )
}

fn finite_coord(value: Option<f64>) -> Option<i32> {
    value.and_then(|raw| {
        if raw.is_finite() {
            Some(raw.round() as i32)
        } else {
            None
        }
    })
}

fn finite_positive(value: f64) -> Option<f64> {
    if value.is_finite() && value > 0.0 {
        Some(value)
    } else {
        None
    }
}

fn clamp_f64_to_u32(value: f64) -> u32 {
    value.round().clamp(1.0, u32::MAX as f64) as u32
}

fn clamp_size_to_monitor(width: Option<f64>, height: Option<f64>, monitor: MonitorBounds) -> (u32, u32) {
    let (min_w, min_h) = monitor.min_physical_size();
    let max_w = monitor.width.max(1);
    let max_h = monitor.height.max(1);
    let width = width
        .map(clamp_f64_to_u32)
        .unwrap_or(min_w)
        .clamp(min_w, max_w);
    let height = height
        .map(clamp_f64_to_u32)
        .unwrap_or(min_h)
        .clamp(min_h, max_h);
    (width, height)
}

fn clamp_position_to_monitor(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    monitor: MonitorBounds,
) -> (i32, i32) {
    let max_x = monitor.right().saturating_sub(width as i32);
    let max_y = monitor.bottom().saturating_sub(height as i32);
    (
        x.clamp(monitor.x, max_x.max(monitor.x)),
        y.clamp(monitor.y, max_y.max(monitor.y)),
    )
}

fn center_on_monitor(width: u32, height: u32, monitor: MonitorBounds) -> (i32, i32) {
    let x = monitor.x + (monitor.width as i32 - width as i32) / 2;
    let y = monitor.y + (monitor.height as i32 - height as i32) / 2;
    (x, y)
}

fn select_target_monitor(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    monitors: &[MonitorBounds],
) -> Option<MonitorBounds> {
    if let Some(monitor) = monitors.iter().copied().find(|monitor| monitor.contains_point(x, y)) {
        return Some(monitor);
    }
    monitors
        .iter()
        .copied()
        .filter(|monitor| monitor.intersection_area(x, y, width, height) > 0)
        .max_by_key(|monitor| monitor.intersection_area(x, y, width, height))
        .or_else(|| nearest_monitor(x, y, monitors))
}

fn nearest_monitor(x: i32, y: i32, monitors: &[MonitorBounds]) -> Option<MonitorBounds> {
    monitors
        .iter()
        .copied()
        .min_by_key(|monitor| monitor.distance_sq_to_point(x, y))
}

fn visible_area(x: i32, y: i32, width: u32, height: u32, monitors: &[MonitorBounds]) -> u64 {
    monitors
        .iter()
        .map(|monitor| monitor.intersection_area(x, y, width, height))
        .sum()
}

fn visible_fraction(x: i32, y: i32, width: u32, height: u32, monitors: &[MonitorBounds]) -> f64 {
    let area = (width as u64).saturating_mul(height as u64);
    if area == 0 {
        return 0.0;
    }
    visible_area(x, y, width, height, monitors) as f64 / area as f64
}

fn title_bar_is_visible(x: i32, y: i32, width: u32, monitors: &[MonitorBounds]) -> bool {
    monitors.iter().any(|monitor| {
        let title_height = monitor.title_bar_height();
        monitor.intersection_area(x, y, width, title_height) > 0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn laptop() -> MonitorBounds {
        MonitorBounds {
            x: 0,
            y: 62,
            width: 3024,
            height: 1898,
            scale_factor: 2.0,
        }
    }

    fn studio_right() -> MonitorBounds {
        MonitorBounds {
            x: 3024,
            y: 0,
            width: 5120,
            height: 2880,
            scale_factor: 2.0,
        }
    }

    #[test]
    fn giant_offscreen_frame_uses_default_size_not_full_display() {
        let display = laptop();
        let frame = sanitize_restored_frame(
            3644.0,
            2818.0,
            Some(6596.0),
            Some(62.0),
            &[display],
            Some(display),
        )
        .unwrap();

        let (default_w, default_h) = display.default_physical_size();
        assert_eq!(frame.width, default_w);
        assert_eq!(frame.height, default_h);
        assert!(frame.width < display.width || frame.height < display.height);
        assert!(frame.width >= 1200);
        assert!(frame.height >= 800);
        assert!(display.contains_point(frame.x, frame.y));
        // Known but off-display origin: clamp toward the saved point on the
        // nearest monitor (do not recenter on primary).
        let (expected_x, expected_y) =
            super::clamp_position_to_monitor(6596, 62, frame.width, frame.height, display);
        assert_eq!(frame.x, expected_x);
        assert_eq!(frame.y, expected_y);
    }

    #[test]
    fn known_good_frame_stays_put() {
        let display = laptop();
        let frame = sanitize_restored_frame(
            1800.0,
            1200.0,
            Some(400.0),
            Some(200.0),
            &[display],
            Some(display),
        )
        .unwrap();

        assert_eq!(frame.width, 1800);
        assert_eq!(frame.height, 1200);
        assert_eq!(frame.x, 400);
        assert_eq!(frame.y, 200);
    }

    #[test]
    fn undersized_window_is_raised_to_logical_minimum() {
        let display = laptop();
        let frame = sanitize_restored_frame(
            200.0,
            150.0,
            Some(100.0),
            Some(100.0),
            &[display],
            Some(display),
        )
        .unwrap();

        assert_eq!(frame.width, 1200);
        assert_eq!(frame.height, 800);
        assert!(display.contains_point(frame.x, frame.y));
    }

    #[test]
    fn overflowing_window_is_pulled_onto_the_display() {
        let display = laptop();
        let frame = sanitize_restored_frame(
            1600.0,
            900.0,
            Some(2800.0),
            Some(1700.0),
            &[display],
            Some(display),
        )
        .unwrap();

        assert_eq!(frame.width, 1600);
        assert_eq!(frame.height, 900);
        assert_eq!(frame.x, display.right() - 1600);
        assert_eq!(frame.y, display.bottom() - 900);
    }

    #[test]
    fn window_on_right_display_stays_there() {
        let left = laptop();
        let right = studio_right();
        let frame = sanitize_restored_frame(
            1800.0,
            1200.0,
            Some(3600.0),
            Some(80.0),
            &[left, right],
            Some(left),
        )
        .unwrap();

        assert_eq!(frame.width, 1800);
        assert_eq!(frame.height, 1200);
        assert_eq!(frame.x, 3600);
        assert_eq!(frame.y, 80);
        assert!(right.contains_point(frame.x, frame.y));
    }

    fn five_k_primary() -> MonitorBounds {
        MonitorBounds {
            x: 0,
            y: 45,
            width: 5120,
            height: 2835,
            scale_factor: 2.0,
        }
    }

    fn qhd_side() -> MonitorBounds {
        // Physical QHD secondary to the right of a 5K primary.
        MonitorBounds {
            x: 5120,
            y: 0,
            width: 2560,
            height: 1440,
            scale_factor: 1.0,
        }
    }

    #[test]
    fn taller_than_side_display_stays_on_side_with_clamped_height() {
        let primary = five_k_primary();
        let side = qhd_side();
        // Mirrors a real Afterword restore: saved height exceeds the side
        // display work-area height but the origin is clearly on that display.
        let frame = sanitize_restored_frame(
            1840.0,
            1730.0,
            Some(6532.0),
            Some(686.0),
            &[primary, side],
            Some(primary),
        )
        .unwrap();

        assert_eq!(frame.width, 1840);
        assert_eq!(frame.height, side.height);
        assert!(side.contains_point(frame.x, frame.y));
        assert!(!primary.contains_point(frame.x, frame.y));
        // Full-height clamp pulls the origin onto the side work area; it must
        // not jump to the primary.
        let (expected_x, expected_y) =
            super::clamp_position_to_monitor(6532, 686, frame.width, frame.height, side);
        assert_eq!(frame.x, expected_x);
        assert_eq!(frame.y, expected_y);
    }

    #[test]
    fn early_single_monitor_then_dual_monitor_re_restore_returns_to_side() {
        let primary = five_k_primary();
        let side = qhd_side();
        let saved_w = 1840.0;
        let saved_h = 1730.0;
        let saved_x = Some(6532.0);
        let saved_y = Some(686.0);

        // First restore while only the primary is enumerated (startup race):
        // origin looks off-screen → clamp onto nearest (primary) edge.
        let early = sanitize_restored_frame(
            saved_w,
            saved_h,
            saved_x,
            saved_y,
            &[primary],
            Some(primary),
        )
        .unwrap();
        assert!(primary.contains_point(early.x, early.y));

        // After monitors are ready, a full re-restore from saved state must put
        // the window back on the side display with height clamped there.
        let ready = sanitize_restored_frame(
            saved_w,
            saved_h,
            saved_x,
            saved_y,
            &[primary, side],
            Some(primary),
        )
        .unwrap();
        assert_eq!(ready.width, 1840);
        assert_eq!(ready.height, side.height);
        assert!(side.contains_point(ready.x, ready.y));
        assert!(!primary.contains_point(ready.x, ready.y));
        let (expected_x, expected_y) =
            super::clamp_position_to_monitor(6532, 686, ready.width, ready.height, side);
        assert_eq!(ready.x, expected_x);
        assert_eq!(ready.y, expected_y);
    }

    #[test]
    fn missing_position_centers_default_size_on_primary() {
        let display = laptop();
        let frame =
            sanitize_restored_frame(911.0, 904.0, None, None, &[display], Some(display)).unwrap();
        let (default_w, default_h) = display.default_physical_size();
        assert_eq!(frame.width, default_w);
        assert_eq!(frame.height, default_h);
        let (cx, cy) = super::center_on_monitor(frame.width, frame.height, display);
        assert_eq!(frame.x, cx);
        assert_eq!(frame.y, cy);
    }

    #[test]
    fn persist_rejects_zero_and_oversized_frames() {
        let display = laptop();
        assert!(!frame_is_persistable(0, 800, Some(10), Some(10), false, &[display]));
        assert!(!frame_is_persistable(3644, 2818, Some(6596), Some(62), false, &[display]));
        assert!(frame_is_persistable(1800, 1200, Some(400), Some(200), false, &[display]));
        assert!(frame_is_persistable(3644, 2818, Some(0), Some(0), true, &[display]));
    }

    #[test]
    fn persist_rejects_title_bar_off_all_displays() {
        let display = laptop();
        assert!(!frame_is_persistable(
            1200,
            800,
            Some(8000),
            Some(80),
            false,
            &[display]
        ));
        assert!(frame_needs_correction(
            WindowFrame {
                width: 3644,
                height: 2818,
                x: 6596,
                y: 62,
            },
            &[display]
        ));
    }
}
