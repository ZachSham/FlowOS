import { parserExamples } from "./parser.mjs";

const transcriptEl = document.querySelector("#transcript");
const commandEl = document.querySelector("#commandString");
const statusEl = document.querySelector("#status");
const resultEl = document.querySelector("#resultJson");
const recordBtn = document.querySelector("#recordBtn");
const stopBtn = document.querySelector("#stopBtn");
const parseBtn = document.querySelector("#parseBtn");
const examplesEl = document.querySelector("#examples");

let recognition = null;
let finalTranscript = "";

function setStatus(message) {
  statusEl.textContent = message;
}

function renderParseResult(result) {
  commandEl.value = result.commandString ?? "";
  resultEl.textContent = JSON.stringify(result, null, 2);
}

async function parseCurrentTranscript() {
  const transcript = transcriptEl.value.trim();
  if (!transcript) {
    const emptyResult = {
      ok: false,
      message: "No transcript detected.",
      commandString: null
    };

    renderParseResult(emptyResult);
    setStatus(emptyResult.message);
    return emptyResult;
  }

  try {
    const response = await fetch("/api/parse", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ transcript })
    });

    const payload = await response.json();
    const result = payload.parsed ?? {
      ok: false,
      message: payload.message ?? "Parse request failed.",
      commandString: null
    };

    renderParseResult(result);
    setStatus(result.ok ? "Transcript parsed." : result.message ?? "Command not recognized.");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    const failedResult = {
      ok: false,
      message: `Parse error: ${message}`,
      commandString: null
    };

    renderParseResult(failedResult);
    setStatus(failedResult.message);
    return failedResult;
  }
}

async function executeCurrentTranscript() {
  const transcript = transcriptEl.value.trim();
  if (!transcript) {
    setStatus("No transcript to execute.");
    return;
  }

  await parseCurrentTranscript();
  setStatus("Executing command...");
  recordBtn.disabled = true;
  stopBtn.disabled = true;

  try {
    const response = await fetch("/api/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ transcript })
    });

    const payload = await response.json();
    resultEl.textContent = JSON.stringify(payload, null, 2);

    if (response.ok && payload.ok) {
      setStatus(payload.message ?? "Executed.");
    } else {
      setStatus(payload.message ?? "Execution failed.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution error";
    setStatus(`Execution error: ${message}`);
  } finally {
    recordBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function setupExamples() {
  examplesEl.innerHTML = "";

  for (const example of parserExamples) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "exampleBtn";
    button.textContent = example;
    button.addEventListener("click", () => {
      transcriptEl.value = example;
      void parseCurrentTranscript();
    });

    examplesEl.appendChild(button);
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setStatus("SpeechRecognition API not available in this browser. Use manual transcript input.");
    recordBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    finalTranscript = "";
    setStatus("Listening...");
    recordBtn.disabled = true;
    stopBtn.disabled = false;
  };

  recognition.onresult = (event) => {
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0]?.transcript ?? "";
      if (event.results[i].isFinal) {
        finalTranscript += `${text} `;
      } else {
        interim += text;
      }
    }

    transcriptEl.value = `${finalTranscript}${interim}`.trim();
  };

  recognition.onerror = (event) => {
    setStatus(`Speech error: ${event.error}`);
    recordBtn.disabled = false;
    stopBtn.disabled = true;
  };

  recognition.onend = () => {
    recordBtn.disabled = false;
    stopBtn.disabled = true;

    if (transcriptEl.value.trim().length > 0) {
      void executeCurrentTranscript();
    } else {
      setStatus("No speech captured.");
    }
  };
}

recordBtn.addEventListener("click", () => {
  if (!recognition) {
    return;
  }

  transcriptEl.value = "";
  commandEl.value = "";
  resultEl.textContent = "{}";

  recognition.start();
});

stopBtn.addEventListener("click", () => {
  recognition?.stop();
});

parseBtn.addEventListener("click", () => {
  void parseCurrentTranscript();
});

setupExamples();
setupSpeechRecognition();
setStatus("Ready. Speak and it will execute automatically.");
