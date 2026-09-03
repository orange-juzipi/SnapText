use snaptext_core::hotkey::HotkeyAction;

/// Decides which native shortcut edge starts an action.
pub(crate) fn should_dispatch_hotkey(
    action: HotkeyAction,
    shortcut_pressed: bool,
    release_windows_selection: bool,
) -> bool {
    match action {
        HotkeyAction::Screenshot => shortcut_pressed,
        HotkeyAction::Selection if release_windows_selection => !shortcut_pressed,
        HotkeyAction::Selection => shortcut_pressed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Keeps screenshot capture on the press edge on every platform.
    #[test]
    fn screenshot_dispatches_only_when_pressed() {
        assert!(should_dispatch_hotkey(HotkeyAction::Screenshot, true, true));
        assert!(!should_dispatch_hotkey(
            HotkeyAction::Screenshot,
            false,
            true
        ));
    }

    /// Defers Windows selection until all shortcut modifiers have been released.
    #[test]
    fn windows_selection_dispatches_only_when_released() {
        assert!(!should_dispatch_hotkey(HotkeyAction::Selection, true, true));
        assert!(should_dispatch_hotkey(HotkeyAction::Selection, false, true));
    }

    /// Preserves press-edge selection behavior on platforms without the Windows key race.
    #[test]
    fn non_windows_selection_dispatches_only_when_pressed() {
        assert!(should_dispatch_hotkey(HotkeyAction::Selection, true, false));
        assert!(!should_dispatch_hotkey(
            HotkeyAction::Selection,
            false,
            false
        ));
    }
}
