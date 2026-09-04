use image::RgbaImage;
use serde::{Deserialize, Serialize};
use xcap::Monitor;

use crate::{Error, Result, ocr::BBox};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageMeta {
    pub width: u32,
    pub height: u32,
    pub path: Option<String>,
}

#[derive(Debug, Default)]
pub struct Screencap;

impl Screencap {
    pub fn new() -> Result<Self> {
        Ok(Self)
    }

    pub async fn capture_full_screen(&self) -> Result<RgbaImage> {
        self.capture_full_screen_at(None).await
    }

    /// Captures the monitor containing the supplied virtual-desktop point.
    pub async fn capture_full_screen_at(&self, point: Option<(i32, i32)>) -> Result<RgbaImage> {
        let monitor = match point {
            Some((x, y)) => {
                Monitor::from_point(x, y).map_err(|err| Error::Screenshot(err.to_string()))?
            }
            None => primary_monitor()?,
        };
        monitor
            .capture_image()
            .map_err(|err| Error::Screenshot(err.to_string()))
    }

    pub async fn capture_region(&self, bbox: BBox) -> Result<RgbaImage> {
        validate_region(bbox)?;

        let monitor = Monitor::from_point(bbox.x as i32, bbox.y as i32)
            .map_err(|err| Error::Screenshot(err.to_string()))?;
        let monitor_x = monitor
            .x()
            .map_err(|err| Error::Screenshot(err.to_string()))?;
        let monitor_y = monitor
            .y()
            .map_err(|err| Error::Screenshot(err.to_string()))?;
        let local_x = (bbox.x as i32 - monitor_x).max(0) as u32;
        let local_y = (bbox.y as i32 - monitor_y).max(0) as u32;
        let monitor_width = monitor
            .width()
            .map_err(|err| Error::Screenshot(err.to_string()))?;
        let monitor_height = monitor
            .height()
            .map_err(|err| Error::Screenshot(err.to_string()))?;

        validate_region_inside_monitor(
            local_x,
            local_y,
            bbox.width,
            bbox.height,
            monitor_width,
            monitor_height,
        )?;

        monitor
            .capture_region(local_x, local_y, bbox.width, bbox.height)
            .map_err(|err| Error::Screenshot(err.to_string()))
    }
}

fn primary_monitor() -> Result<Monitor> {
    let monitors = Monitor::all().map_err(|err| Error::Screenshot(err.to_string()))?;
    if monitors.is_empty() {
        return Err(Error::Screenshot("no monitor available".to_owned()));
    }

    for monitor in &monitors {
        if monitor
            .is_primary()
            .map_err(|err| Error::Screenshot(err.to_string()))?
        {
            return Ok(monitor.clone());
        }
    }

    monitors
        .into_iter()
        .next()
        .ok_or_else(|| Error::Screenshot("no monitor available".to_owned()))
}

pub fn validate_region(bbox: BBox) -> Result<()> {
    if bbox.width == 0 || bbox.height == 0 {
        return Err(Error::Screenshot(
            "capture region cannot be empty".to_owned(),
        ));
    }

    Ok(())
}

fn validate_region_inside_monitor(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    monitor_width: u32,
    monitor_height: u32,
) -> Result<()> {
    let right = x
        .checked_add(width)
        .ok_or_else(|| Error::Screenshot("capture region exceeds monitor bounds".to_owned()))?;
    let bottom = y
        .checked_add(height)
        .ok_or_else(|| Error::Screenshot("capture region exceeds monitor bounds".to_owned()))?;

    if right > monitor_width || bottom > monitor_height {
        return Err(Error::Screenshot(format!(
            "capture region {x},{y} {width}x{height} exceeds monitor bounds {monitor_width}x{monitor_height}"
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_region_rejects_empty_region() {
        let err = validate_region(BBox {
            x: 0,
            y: 0,
            width: 0,
            height: 10,
        })
        .expect_err("empty region");

        assert!(err.to_string().contains("capture region cannot be empty"));
    }

    #[test]
    fn validate_region_accepts_non_empty_region() {
        validate_region(BBox {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
        })
        .expect("valid region");
    }

    #[test]
    fn validate_region_inside_monitor_accepts_fitting_region() {
        validate_region_inside_monitor(90, 80, 10, 20, 100, 100).expect("fits monitor");
    }

    #[test]
    fn validate_region_inside_monitor_rejects_overflowing_region() {
        let err =
            validate_region_inside_monitor(95, 80, 10, 20, 100, 100).expect_err("out of bounds");

        assert!(err.to_string().contains("exceeds monitor bounds"));
    }

    #[test]
    fn validate_region_inside_monitor_rejects_integer_overflow() {
        let err = validate_region_inside_monitor(u32::MAX, 0, 1, 1, u32::MAX, u32::MAX)
            .expect_err("integer overflow");

        assert!(err.to_string().contains("exceeds monitor bounds"));
    }
}
