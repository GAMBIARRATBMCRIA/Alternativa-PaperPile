const setupPanel = document.getElementById("setupPanel");
const connectedPanel = document.getElementById("connectedPanel");
const statusBox = document.getElementById("status");
const apiKeyInput = document.getElementById("apiKey");
const connectButton = document.getElementById("connectButton");
const disconnectButton = document.getElementById("disconnectButton");

function setStatus(message, kind = "") {
  statusBox.textContent = message || "";
  statusBox.className = `status ${kind}`;
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) return reject(new Error(runtimeError.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response);
    });
  });
}

async function refresh() {
  try {
    const status = await send({ type: "GET_STATUS" });
    setupPanel.classList.toggle("hidden", status.connected);
    connectedPanel.classList.toggle("hidden", !status.connected);
    if (status.connected) {
      document.getElementById("accountLabel").textContent = `${status.username || "Conta Zotero"} · ID ${status.userID}`;
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
}

connectButton.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return setStatus("Informe sua API Key.", "error");
  connectButton.disabled = true;
  connectButton.textContent = "Verificando chave…";
  setStatus("Validando acesso à biblioteca pessoal…");
  try {
    const result = await send({ type: "CONNECT", apiKey: key });
    apiKeyInput.value = "";
    setStatus(`Conectado à conta ${result.username}.`, "success");
    await refresh();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = "Conectar ao Zotero";
  }
});

disconnectButton.addEventListener("click", async () => {
  disconnectButton.disabled = true;
  try {
    await send({ type: "DISCONNECT" });
    setStatus("Conta desconectada.", "success");
    await refresh();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    disconnectButton.disabled = false;
  }
});

refresh();
