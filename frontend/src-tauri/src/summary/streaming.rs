//! Decode Ollama's OpenAI-compatible text stream without exposing reasoning deltas.
use reqwest::Response;

pub type OnTextDelta<'a> = dyn Fn(&str) -> Result<(), String> + Send + Sync + 'a;

#[derive(Default)]
struct TextStream {
    pending: Vec<u8>,
    data: String,
    answer: String,
    stopped: bool,
    done: bool,
}

impl TextStream {
    fn push(&mut self, bytes: &[u8], emit: &OnTextDelta<'_>) -> Result<(), String> {
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line = self.pending.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line).map_err(|_| "Invalid UTF-8 in assistant stream")?
                .trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                self.event(emit)?;
                if self.done { break; }
            } else if let Some(value) = line.strip_prefix("data:") {
                if !self.data.is_empty() { self.data.push('\n'); }
                self.data.push_str(value.strip_prefix(' ').unwrap_or(value));
            }
            if self.data.len() > 1_048_576 { return Err("Assistant stream event is too large".into()); }
        }
        if self.pending.len() > 1_048_576 { return Err("Assistant stream event is too large".into()); }
        Ok(())
    }

    fn event(&mut self, emit: &OnTextDelta<'_>) -> Result<(), String> {
        let data = std::mem::take(&mut self.data);
        if data.is_empty() { return Ok(()); }
        if data.trim() == "[DONE]" {
            if !self.stopped || self.answer.trim().is_empty() {
                return Err("Assistant returned an incomplete or empty answer. Try again.".into());
            }
            self.done = true;
            return Ok(());
        }
        let event: serde_json::Value = serde_json::from_str(&data)
            .map_err(|_| "Invalid assistant stream event")?;
        if event.get("error").is_some() { return Err("The model could not finish this answer. Try again.".into()); }
        if let Some(choice) = event["choices"].as_array().and_then(|items| items.first()) {
            if let Some(text) = choice["delta"]["content"].as_str().filter(|text| !text.is_empty()) {
                self.answer.push_str(text);
                emit(text)?;
            }
            if let Some(reason) = choice["finish_reason"].as_str() {
                if reason != "stop" {
                    return Err(if reason == "length" { "Answer reached its length limit. Ask a narrower question." }
                        else { "The model could not finish this answer. Try again." }.into());
                }
                self.stopped = true;
            }
        }
        Ok(())
    }
}

pub async fn read_text_stream(mut response: Response, emit: &OnTextDelta<'_>) -> Result<String, String> {
    let mut stream = TextStream::default();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Assistant connection interrupted. Try again.")? {
        stream.push(&chunk, emit)?;
        if stream.done { return Ok(stream.answer.trim().to_string()); }
    }
    Err("Assistant connection ended before the answer was complete. Try again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn fragmented_unicode_citations_and_reasoning_are_handled_without_losing_text() {
        let wire = concat!(
            ": heartbeat\r\n\r\n",
            "data: {\"choices\":[{\"delta\":{\"reasoning\":\"Hidden\",\"content\":\"Preserve café \"}}]}\r\n\r\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"[S1](#source-S1).\"},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n"
        );
        let pieces = Mutex::new(String::new());
        let emit = |delta: &str| { pieces.lock().unwrap().push_str(delta); Ok(()) };
        let mut stream = TextStream::default();
        for byte in wire.as_bytes() { stream.push(&[*byte], &emit).unwrap(); }
        assert!(stream.done);
        assert_eq!(stream.answer, "Preserve café [S1](#source-S1).");
        assert_eq!(*pieces.lock().unwrap(), stream.answer);
    }

    #[test]
    fn partial_or_invalid_streams_never_become_completed_answers() {
        let emit = |_: &str| Ok(());
        let mut stream = TextStream::default();
        stream.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n", &emit).unwrap();
        assert!(!stream.done);
        assert!(stream.push(b"data: [DONE]\n\n", &emit).is_err());
        let mut limited = TextStream::default();
        assert!(limited.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"},\"finish_reason\":\"length\"}]}\n\n", &emit).unwrap_err().contains("length limit"));
        assert!(TextStream::default().push(b"data: broken json\n\n", &emit).is_err());
        assert!(TextStream::default().push(b"data: {\"error\":\"failed\"}\n\n", &emit).is_err());
    }
}
