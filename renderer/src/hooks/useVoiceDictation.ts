import { useCallback, useRef, useState } from "react";

export type VoiceDictationHook = {
  isListening: boolean;
  lastTranscript: string;
  error: string | null;
  supported: boolean;
  start: () => void;
  stop: () => void;
};

export function useVoiceDictation(
  onTranscript: (transcript: string) => void
): VoiceDictationHook {
  const [isListening, setIsListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const start = useCallback(() => {
    setError(null);
    setLastTranscript("");

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });

          blob
            .arrayBuffer()
            .then(async (buffer) => {
              const transcript = await window.flowos?.transcribeAudio(new Uint8Array(buffer));
              if (transcript) {
                setLastTranscript(transcript);
                onTranscriptRef.current(transcript);
              }
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "Transcription failed.");
            });
        };

        recorder.start();
        recorderRef.current = recorder;
        setIsListening(true);
      })
      .catch((err: unknown) => {
        setError(`Microphone error: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setIsListening(false);
  }, []);

  return {
    isListening,
    lastTranscript,
    error,
    supported: typeof navigator !== "undefined" && "mediaDevices" in navigator,
    start,
    stop
  };
}
