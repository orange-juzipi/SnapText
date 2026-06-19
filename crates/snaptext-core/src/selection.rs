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

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr;

    use core_foundation::{
        base::{CFType, TCFType},
        string::CFString,
    };
    use core_foundation_sys::{
        base::{CFRelease, CFTypeRef},
        dictionary::CFDictionaryRef,
        string::CFStringRef,
    };
    use objc2::rc::Retained;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;

    use super::{SelectionEvent, selection_event_from_text};
    use crate::{Error, Result};

    type AXUIElementRef = *const core::ffi::c_void;
    type AXError = i32;
    type Boolean = u8;

    const K_AX_ERROR_SUCCESS: AXError = 0;
    const K_AX_ERROR_NO_VALUE: AXError = -25212;
    const K_AX_ERROR_ATTRIBUTE_UNSUPPORTED: AXError = -25205;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> Boolean;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
    }

    pub fn current_selection() -> Result<Option<SelectionEvent>> {
        if !is_accessibility_trusted() {
            return Ok(None);
        }

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
        let app_bundle_id = frontmost_bundle_identifier();

        // Keep macOS Accessibility output consistent with Linux and Windows
        // selection readers before the text enters the translation pipeline.
        Ok(selection_event_from_text(selected_text, app_bundle_id))
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
