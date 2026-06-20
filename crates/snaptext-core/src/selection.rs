use serde::{Deserialize, Serialize};

use crate::Result;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelectionEvent {
    pub text: String,
    pub app_bundle_id: Option<String>,
}

#[derive(Debug, Default)]
pub struct SelectionWatcher;

impl SelectionWatcher {
    pub fn new() -> Result<Self> {
        Ok(Self)
    }

    pub async fn current_selection(&self) -> Result<Option<SelectionEvent>> {
        current_selection_impl()
    }
}

#[cfg(target_os = "macos")]
fn current_selection_impl() -> Result<Option<SelectionEvent>> {
    macos::current_selection()
}

#[cfg(target_os = "linux")]
fn current_selection_impl() -> Result<Option<SelectionEvent>> {
    linux::current_selection()
}

#[cfg(target_os = "windows")]
fn current_selection_impl() -> Result<Option<SelectionEvent>> {
    windows::current_selection()
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn current_selection_impl() -> Result<Option<SelectionEvent>> {
    Ok(None)
}

#[cfg(target_os = "macos")]
pub fn selection_permission_status() -> &'static str {
    macos::selection_permission_status()
}

#[cfg(target_os = "macos")]
pub fn ensure_selection_permission() -> Result<()> {
    macos::ensure_selection_permission()
}

#[cfg(not(target_os = "macos"))]
pub fn selection_permission_status() -> &'static str {
    "available"
}

#[cfg(not(target_os = "macos"))]
pub fn ensure_selection_permission() -> Result<()> {
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows", test))]
fn selection_event_from_text(
    text: impl AsRef<str>,
    app_bundle_id: Option<String>,
) -> Option<SelectionEvent> {
    let text = normalize_selection_text(text);
    (!text.is_empty()).then_some(SelectionEvent {
        text,
        app_bundle_id,
    })
}

pub fn normalize_selection_text(text: impl AsRef<str>) -> String {
    let normalized = text
        .as_ref()
        .replace('\0', "")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let mut lines = Vec::new();
    let mut previous_blank = true;

    for line in normalized.lines().map(str::trim) {
        if line.is_empty() {
            if !previous_blank {
                lines.push(String::new());
            }
            previous_blank = true;
        } else {
            lines.push(line.to_owned());
            previous_blank = false;
        }
    }

    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }

    lines.join("\n")
}

pub fn looks_like_garbled_selection(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() {
        return false;
    }

    let visible_chars = text.chars().filter(|ch| !ch.is_whitespace()).count();
    if visible_chars < 4 {
        return false;
    }

    let longest_replacement_run = longest_placeholder_run(text);
    if longest_replacement_run >= 4 {
        return true;
    }
    if looks_like_mojibake_selection(text, visible_chars) {
        return true;
    }

    let replacement_marks = text.chars().filter(|ch| *ch == '?' || *ch == '�').count();
    let alphanumeric_chars = text.chars().filter(|ch| ch.is_alphanumeric()).count();
    let cjk_chars = text
        .chars()
        .filter(|ch| {
            matches!(
                *ch as u32,
                0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
            )
        })
        .count();

    // Some macOS selection providers degrade non-Latin text to placeholder
    // question marks. Reject only placeholder-heavy text so normal English
    // questions like "what??? really?" remain valid selections.
    replacement_marks >= 3
        && replacement_marks * 3 >= visible_chars
        && replacement_marks > alphanumeric_chars + cjk_chars
}

fn looks_like_mojibake_selection(text: &str, visible_chars: usize) -> bool {
    let c1_controls = text
        .chars()
        .filter(|ch| matches!(*ch as u32, 0x80..=0x9F))
        .count();
    if c1_controls > 0 {
        return true;
    }

    let mojibake_markers = text
        .chars()
        .filter(|ch| {
            matches!(
                ch,
                'Ã' | 'Â' | 'â' | '€' | '™' | 'œ' | 'ä' | 'å' | 'æ' | 'è' | 'é'
            )
        })
        .count();
    if mojibake_markers < 3 {
        return false;
    }

    let cjk_chars = text
        .chars()
        .filter(|ch| {
            matches!(
                *ch as u32,
                0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
            )
        })
        .count();

    // UTF-8 text decoded as Latin-1 or Windows-1252 commonly shows dense runs
    // like "ä¸­æ–‡". Require marker-heavy text and no real CJK to avoid
    // rejecting normal European-language selections.
    cjk_chars == 0 && mojibake_markers * 4 >= visible_chars
}

fn longest_placeholder_run(text: &str) -> usize {
    let mut longest = 0;
    let mut current = 0;
    for ch in text.chars() {
        if ch == '?' || ch == '�' {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 0;
        }
    }
    longest
}

#[cfg(target_os = "macos")]
mod macos {
    use std::{ptr, thread, time::Duration};

    use core_foundation::{
        base::{CFType, TCFType},
        boolean::CFBoolean,
        dictionary::CFDictionary,
        string::CFString,
    };
    use core_foundation_sys::{
        base::{CFRelease, CFTypeRef},
        dictionary::CFDictionaryRef,
        string::CFStringRef,
    };
    use objc2::rc::Retained;
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString, NSWorkspace};
    use objc2_foundation::NSString;

    use super::{SelectionEvent, looks_like_garbled_selection, selection_event_from_text};
    use crate::{Error, Result};

    type AXUIElementRef = *const core::ffi::c_void;
    type CGEventRef = *mut core::ffi::c_void;
    type CGEventSourceRef = *mut core::ffi::c_void;
    type CGEventFlags = u64;
    type CGEventSourceStateID = i32;
    type CGEventTapLocation = u32;
    type CGKeyCode = u16;
    type AXError = i32;
    type Boolean = u8;

    const K_AX_ERROR_SUCCESS: AXError = 0;
    const K_AX_ERROR_NO_VALUE: AXError = -25212;
    const K_AX_ERROR_ATTRIBUTE_UNSUPPORTED: AXError = -25205;
    const K_CG_EVENT_SOURCE_STATE_PRIVATE: CGEventSourceStateID = -1;
    const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: CGEventSourceStateID = 1;
    const K_CG_HID_EVENT_TAP: CGEventTapLocation = 0;
    const K_CG_EVENT_FLAG_MASK_SHIFT: CGEventFlags = 1 << 17;
    const K_CG_EVENT_FLAG_MASK_CONTROL: CGEventFlags = 1 << 18;
    const K_CG_EVENT_FLAG_MASK_ALTERNATE: CGEventFlags = 1 << 19;
    const K_CG_EVENT_FLAG_MASK_COMMAND: CGEventFlags = 1 << 20;
    const ACTIVE_HOTKEY_MODIFIER_MASK: CGEventFlags = K_CG_EVENT_FLAG_MASK_SHIFT
        | K_CG_EVENT_FLAG_MASK_CONTROL
        | K_CG_EVENT_FLAG_MASK_ALTERNATE
        | K_CG_EVENT_FLAG_MASK_COMMAND;
    const CLIPBOARD_COPY_SETTLE_MS: u64 = 80;
    const CLIPBOARD_COPY_ATTEMPTS: usize = 6;
    const CLIPBOARD_COPY_ROUNDS: usize = 3;
    const HOTKEY_MODIFIER_RELEASE_SETTLE_MS: u64 = 40;
    const HOTKEY_MODIFIER_RELEASE_ATTEMPTS: usize = 30;
    const AX_TRUSTED_CHECK_OPTION_PROMPT: &str = "AXTrustedCheckOptionPrompt";
    const KEY_CODE_C: CGKeyCode = 8;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> Boolean;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn CGEventSourceCreate(state_id: CGEventSourceStateID) -> CGEventSourceRef;
        fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef,
            virtual_key: CGKeyCode,
            key_down: bool,
        ) -> CGEventRef;
        fn CGEventSourceFlagsState(state_id: CGEventSourceStateID) -> CGEventFlags;
        fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
        fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
    }

    pub fn current_selection() -> Result<Option<SelectionEvent>> {
        ensure_accessibility_permission(false)?;
        let app_bundle_id = frontmost_bundle_identifier();

        if let Some(event) = current_clipboard_selection(app_bundle_id.clone())? {
            return Ok(Some(event));
        }

        if let Some(event) = current_accessibility_selection(app_bundle_id)? {
            if looks_like_garbled_selection(&event.text) {
                tracing::warn!("macOS Accessibility selected text looked garbled");
                return Ok(None);
            }
            return Ok(Some(event));
        }

        Ok(None)
    }

    pub fn selection_permission_status() -> &'static str {
        if is_accessibility_trusted() {
            "authorized"
        } else {
            "requires_accessibility_permission"
        }
    }

    pub fn ensure_selection_permission() -> Result<()> {
        ensure_accessibility_permission(true)
    }

    fn ensure_accessibility_permission(prompt: bool) -> Result<()> {
        if is_accessibility_trusted() {
            return Ok(());
        }
        if prompt {
            let prompt_key = CFString::new(AX_TRUSTED_CHECK_OPTION_PROMPT);
            let prompt_value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(prompt_key, prompt_value)]);
            unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };
        }

        Err(Error::Selection(
            "Accessibility permission is required before reading selected text".to_owned(),
        ))
    }

    fn current_accessibility_selection(
        app_bundle_id: Option<String>,
    ) -> Result<Option<SelectionEvent>> {
        let system = unsafe { AXUIElementCreateSystemWide() };
        if system.is_null() {
            return Err(Error::Selection(
                "failed to create macOS accessibility system object".to_owned(),
            ));
        }

        let focused = copy_attribute_value(system, "AXFocusedUIElement")?;
        let Some(focused) = focused else {
            return Ok(None);
        };

        let focused_element = focused.as_CFTypeRef() as AXUIElementRef;
        let selected_text = copy_attribute_value(focused_element, "AXSelectedText")?;
        let Some(selected_text) = selected_text else {
            return Ok(None);
        };

        let selected_text = selected_text
            .downcast::<CFString>()
            .map(|value| value.to_string())
            .unwrap_or_default();

        // Keep macOS Accessibility output consistent with Linux and Windows
        // selection readers before the text enters the translation pipeline.
        Ok(selection_event_from_text(selected_text, app_bundle_id))
    }

    fn current_clipboard_selection(
        app_bundle_id: Option<String>,
    ) -> Result<Option<SelectionEvent>> {
        let previous_clipboard = read_clipboard_text().ok();
        let marker = format!("__SNAPTEXT_SELECTION_MARKER_{}__", uuid::Uuid::new_v4());
        write_clipboard_text(&marker)?;
        if !copy_frontmost_selection_to_clipboard(&marker)? {
            if let Some(previous) = previous_clipboard {
                restore_clipboard(&previous);
            }
            return Ok(None);
        }

        let selected_text = read_clipboard_text()?;

        if let Some(previous) = previous_clipboard {
            // Cmd+C is the pragmatic fallback for apps that do not expose AXSelectedText.
            // Restore the plain-text clipboard so the fallback is less disruptive.
            restore_clipboard(&previous);
        }

        let event = selection_event_from_text(selected_text, app_bundle_id);
        if event
            .as_ref()
            .is_some_and(|event| looks_like_garbled_selection(&event.text))
        {
            tracing::warn!("macOS clipboard selected text still looked garbled");
            return Ok(None);
        }
        Ok(event)
    }

    fn copy_frontmost_selection_to_clipboard(marker: &str) -> Result<bool> {
        for round in 0..CLIPBOARD_COPY_ROUNDS {
            let marker_change_count = clipboard_change_count();
            copy_frontmost_selection()?;
            if wait_for_copied_selection(marker_change_count, marker)? {
                return Ok(true);
            }

            // Some hotkey chords, especially Option-based dead keys, can still
            // be settling when the handler starts. Retry after the key state has
            // had another short window to return to neutral.
            if round + 1 < CLIPBOARD_COPY_ROUNDS {
                thread::sleep(Duration::from_millis(CLIPBOARD_COPY_SETTLE_MS));
            }
        }

        Ok(false)
    }

    fn clipboard_change_count() -> isize {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.changeCount()
    }

    fn wait_for_copied_selection(previous_change_count: isize, marker: &str) -> Result<bool> {
        for _ in 0..CLIPBOARD_COPY_ATTEMPTS {
            thread::sleep(Duration::from_millis(CLIPBOARD_COPY_SETTLE_MS));
            if clipboard_change_count() == previous_change_count {
                continue;
            }

            let text = read_clipboard_text()?;
            if text != marker {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn restore_clipboard(previous: &str) {
        if let Err(err) = write_clipboard_text(previous) {
            tracing::warn!(error = %err, "failed to restore clipboard after selection fallback");
        }
    }

    fn copy_frontmost_selection() -> Result<()> {
        // Send Cmd+C from the SnapText process instead of delegating through
        // osascript; macOS blocks System Events key injection separately.
        wait_for_hotkey_modifiers_to_release();

        let source = unsafe { CGEventSourceCreate(K_CG_EVENT_SOURCE_STATE_PRIVATE) };
        if source.is_null() {
            return Err(Error::Selection(
                "failed to create macOS keyboard event source".to_owned(),
            ));
        }

        let key_down = unsafe { CGEventCreateKeyboardEvent(source, KEY_CODE_C, true) };
        let key_up = unsafe { CGEventCreateKeyboardEvent(source, KEY_CODE_C, false) };

        if key_down.is_null() || key_up.is_null() {
            release_cf_object(key_down);
            release_cf_object(key_up);
            release_cf_object(source);
            return Err(Error::Selection(
                "failed to create macOS copy keyboard event".to_owned(),
            ));
        }

        unsafe {
            CGEventSetFlags(key_down, K_CG_EVENT_FLAG_MASK_COMMAND);
            CGEventSetFlags(key_up, K_CG_EVENT_FLAG_MASK_COMMAND);
            CGEventPost(K_CG_HID_EVENT_TAP, key_down);
            CGEventPost(K_CG_HID_EVENT_TAP, key_up);
        }

        release_cf_object(key_down);
        release_cf_object(key_up);
        release_cf_object(source);
        Ok(())
    }

    fn wait_for_hotkey_modifiers_to_release() {
        for _ in 0..HOTKEY_MODIFIER_RELEASE_ATTEMPTS {
            let flags =
                unsafe { CGEventSourceFlagsState(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE) };
            if flags & ACTIVE_HOTKEY_MODIFIER_MASK == 0 {
                return;
            }
            thread::sleep(Duration::from_millis(HOTKEY_MODIFIER_RELEASE_SETTLE_MS));
        }

        // Continue after a short wait so holding a modifier key does not hang
        // selection translation. The synthetic copy event still sets only Cmd.
        tracing::debug!("copying selection while a keyboard modifier is still pressed");
    }

    fn read_clipboard_text() -> Result<String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        Ok(pasteboard
            .stringForType(unsafe { NSPasteboardTypeString })
            .map(|value| value.to_string())
            .unwrap_or_default())
    }

    fn write_clipboard_text(text: &str) -> Result<()> {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();
        let text = NSString::from_str(text);
        if pasteboard.setString_forType(&text, unsafe { NSPasteboardTypeString }) {
            Ok(())
        } else {
            Err(Error::Selection(
                "failed to write clipboard text".to_owned(),
            ))
        }
    }

    fn frontmost_bundle_identifier() -> Option<String> {
        let workspace = NSWorkspace::sharedWorkspace();
        let application = workspace.frontmostApplication()?;
        let bundle_identifier: Option<Retained<NSString>> = application.bundleIdentifier();
        bundle_identifier.map(|value| value.to_string())
    }

    fn is_accessibility_trusted() -> bool {
        (unsafe { AXIsProcessTrustedWithOptions(ptr::null()) }) != 0
    }

    fn copy_attribute_value(element: AXUIElementRef, attribute: &str) -> Result<Option<CFType>> {
        let attribute = CFString::new(attribute);
        let mut value: CFTypeRef = ptr::null_mut();
        let status = unsafe {
            AXUIElementCopyAttributeValue(element, attribute.as_concrete_TypeRef(), &mut value)
        };

        match status {
            K_AX_ERROR_SUCCESS => {
                if value.is_null() {
                    return Ok(None);
                }

                Ok(Some(unsafe { CFType::wrap_under_create_rule(value) }))
            }
            K_AX_ERROR_NO_VALUE | K_AX_ERROR_ATTRIBUTE_UNSUPPORTED => Ok(None),
            _ => Err(Error::Selection(format!(
                "macOS Accessibility query failed with AXError {status}"
            ))),
        }
    }

    #[allow(dead_code)]
    fn release_ax_element(element: AXUIElementRef) {
        if !element.is_null() {
            unsafe { CFRelease(element.cast()) };
        }
    }

    fn release_cf_object(object: *const core::ffi::c_void) {
        if !object.is_null() {
            unsafe { CFRelease(object) };
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::{
        io,
        process::{Command, Output},
    };

    use super::{SelectionEvent, selection_event_from_text};
    use crate::{Error, Result};

    #[derive(Debug, Clone, Copy)]
    struct SelectionCommand {
        program: &'static str,
        args: &'static [&'static str],
    }

    const SELECTION_COMMANDS: &[SelectionCommand] = &[
        // Wayland compositors commonly expose the primary selection through wl-clipboard.
        SelectionCommand {
            program: "wl-paste",
            args: &["--primary", "--no-newline"],
        },
        SelectionCommand {
            program: "wl-paste",
            args: &["--no-newline"],
        },
        // X11 keeps selected text in PRIMARY; CLIPBOARD is a useful fallback.
        SelectionCommand {
            program: "xclip",
            args: &["-selection", "primary", "-out"],
        },
        SelectionCommand {
            program: "xclip",
            args: &["-selection", "clipboard", "-out"],
        },
        SelectionCommand {
            program: "xsel",
            args: &["--primary", "--output"],
        },
        SelectionCommand {
            program: "xsel",
            args: &["--clipboard", "--output"],
        },
    ];

    pub fn current_selection() -> Result<Option<SelectionEvent>> {
        for command in SELECTION_COMMANDS {
            match run_selection_command(*command)? {
                Some(text) => {
                    if let Some(event) = selection_event_from_text(text, None) {
                        return Ok(Some(event));
                    }
                }
                None => continue,
            }
        }

        Ok(None)
    }

    fn run_selection_command(command: SelectionCommand) -> Result<Option<String>> {
        let output = match Command::new(command.program).args(command.args).output() {
            Ok(output) => output,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(err) => {
                return Err(Error::Selection(format!(
                    "failed to run {}: {err}",
                    command.program
                )));
            }
        };

        parse_selection_command_output(command.program, output)
    }

    fn parse_selection_command_output(program: &str, output: Output) -> Result<Option<String>> {
        if output.status.success() {
            return Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned()));
        }

        if output.status.code() == Some(1) && output.stdout.is_empty() {
            return Ok(None);
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if stderr.is_empty() {
            return Ok(None);
        }

        Err(Error::Selection(format!(
            "{program} failed while reading Linux selection: {stderr}"
        )))
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::{
        io,
        process::{Command, Output},
    };

    use super::{SelectionEvent, selection_event_from_text};
    use crate::{Error, Result};

    const UIA_SELECTION_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) { exit 1 }
$pattern = $null
if (-not $focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { exit 1 }
$ranges = $pattern.GetSelection()
if ($null -eq $ranges -or $ranges.Count -eq 0) { exit 1 }
$texts = New-Object System.Collections.Generic.List[string]
foreach ($range in $ranges) {
    $text = $range.GetText(-1)
    if (-not [string]::IsNullOrWhiteSpace($text)) {
        $texts.Add($text)
    }
}
if ($texts.Count -eq 0) { exit 1 }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Write(($texts -join "`n"))
"#;

    pub fn current_selection() -> Result<Option<SelectionEvent>> {
        let output = match Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                UIA_SELECTION_SCRIPT,
            ])
            .output()
        {
            Ok(output) => output,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(err) => {
                return Err(Error::Selection(format!(
                    "failed to run powershell UI Automation selection reader: {err}"
                )));
            }
        };

        parse_powershell_selection_output(output)
    }

    fn parse_powershell_selection_output(output: Output) -> Result<Option<SelectionEvent>> {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).into_owned();
            return Ok(selection_event_from_text(text, None));
        }

        if output.status.code() == Some(1) {
            return Ok(None);
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if stderr.is_empty() {
            return Ok(None);
        }

        Err(Error::Selection(format!(
            "PowerShell UI Automation selection reader failed: {stderr}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_event_keeps_text_payload() {
        let event = SelectionEvent {
            text: "hello".to_owned(),
            app_bundle_id: Some("com.example.app".to_owned()),
        };

        assert_eq!(event.text, "hello");
        assert_eq!(event.app_bundle_id.as_deref(), Some("com.example.app"));
    }

    #[test]
    fn normalizes_selection_text() {
        assert_eq!(
            normalize_selection_text("\n\t hello world \r\0"),
            "hello world"
        );
    }

    #[test]
    fn detects_placeholder_heavy_garbled_selection_text() {
        assert!(looks_like_garbled_selection(
            "??? API ???????????? AI ???????? OpenAI ?? � ???? base URL ?????"
        ));
        assert!(looks_like_garbled_selection(
            "??????????python3 scripts/package_desktop.py --no-sign ?? DMG\n???????????????????????? DMG ??"
        ));
        assert!(looks_like_garbled_selection("åè¯ä¸­æå°±æé®é¢"));
        assert!(!looks_like_garbled_selection("OpenAI base URL 是什么？"));
        assert!(!looks_like_garbled_selection("what??? really?"));
        assert!(!looks_like_garbled_selection(
            "déjà vu café résumé — normal accents"
        ));
    }

    #[test]
    fn normalizes_multiline_selection_text() {
        assert_eq!(
            normalize_selection_text("\0 first line \r\n\tsecond line\t\r\n\r\n\r\n third line \0"),
            "first line\nsecond line\n\nthird line"
        );
    }

    #[test]
    fn empty_selection_text_returns_no_event() {
        assert_eq!(selection_event_from_text(" \n\t", None), None);
    }

    #[test]
    fn selection_event_normalizes_text_and_preserves_app_context() {
        let event = selection_event_from_text(
            "\0 hello \r\n\r\n world \t",
            Some("com.example.editor".to_owned()),
        )
        .expect("selection event");

        assert_eq!(event.text, "hello\n\nworld");
        assert_eq!(event.app_bundle_id.as_deref(), Some("com.example.editor"));
    }
}
