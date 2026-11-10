use std::io::Read;
use std::path::{Path, PathBuf};

/// Recognize one local image, without interpreting shell expressions.
pub fn image_path(input: &str) -> Option<PathBuf> {
    let input = input.trim();
    if input.is_empty() || input.contains('\n') || input.contains('\0') {
        return None;
    }
    let direct = expand(input);
    if let Some(path) = readable_image(&direct) {
        return Some(path);
    }
    let token = shell_word(input)?;
    let path = if let Some(uri) = token.strip_prefix("file://") {
        let local = if let Some(local) = uri.strip_prefix("localhost/") {
            format!("/{local}")
        } else if uri.starts_with('/') {
            uri.to_string()
        } else {
            return None;
        };
        percent_decode(&local)?
    } else {
        token
    };
    readable_image(&expand(&path))
}

fn expand(text: &str) -> PathBuf {
    if let Some(rest) = text.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(text)
}

fn readable_image(path: &Path) -> Option<PathBuf> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "webp"].contains(&extension.as_str()) {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut header = [0u8; 12];
    let count = file.read(&mut header).ok()?;
    let valid = (extension == "png" && count >= 8 && &header[..8] == b"\x89PNG\r\n\x1a\n")
        || (["jpg", "jpeg"].contains(&extension.as_str())
            && count >= 3
            && header[..3] == [0xff, 0xd8, 0xff])
        || (extension == "webp"
            && count >= 12
            && &header[..4] == b"RIFF"
            && &header[8..12] == b"WEBP");
    valid.then(|| path.canonicalize().ok()).flatten()
}

fn shell_word(text: &str) -> Option<String> {
    let mut out = String::new();
    let mut chars = text.chars();
    let mut quote = None;
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some('\''), '\'') | (Some('"'), '"') => quote = None,
            (None, '\'') | (None, '"') => quote = Some(c),
            (Some('\''), _) => out.push(c),
            (_, '\\') => out.push(chars.next()?),
            (None, c) if c.is_whitespace() => return None,
            (_, c) => out.push(c),
        }
    }
    if quote.is_some() {
        None
    } else {
        Some(out)
    }
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let a = (*bytes.get(i + 1)? as char).to_digit(16)?;
            let b = (*bytes.get(i + 2)? as char).to_digit(16)?;
            out.push((a * 16 + b) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_terminal_path_forms_without_shell_evaluation() {
        let dir = std::env::temp_dir().join(format!("exact-create-image-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pedometer reference.png");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\n").unwrap();
        let expected = path.canonicalize().unwrap();
        let plain = path.to_str().unwrap();
        for text in [
            plain.to_string(),
            format!("'{plain}'"),
            format!("\"{plain}\""),
            plain.replace(' ', "\\ "),
            format!("file://{}", plain.replace(' ', "%20")),
        ] {
            assert_eq!(image_path(&text), Some(expected.clone()), "{text}");
        }
        assert_eq!(image_path("Build an app from this screenshot"), None);
        assert_eq!(image_path("/missing/image.png"), None);
        assert_eq!(image_path("file://remote.example/image.png"), None);
        assert_eq!(image_path("$(touch /tmp/nope).png"), None);
        std::fs::write(&path, b"not an image").unwrap();
        assert_eq!(image_path(plain), None);
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }
}
