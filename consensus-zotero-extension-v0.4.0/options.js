const connectionNotice = document.getElementById("connectionNotice");
const settingsPanel = document.getElementById("settingsPanel");
const collectionSelect = document.getElementById("defaultCollection");
const saveButton = document.getElementById("saveButton");
const refreshButton = document.getElementById("refreshButton");
const statusBox = document.getElementById("status");

function setStatus(message, kind = "") {
  statusBox.textContent = message || "";
  statusBox.className = `status ${kind}`.trim();
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

function flattenCollections(collections) {
  const byKey = new Map(collections.map((item) => [item.key, item]));
  return collections.slice().sort((a,b) => a.name.localeCompare(b.name, "pt-BR")).map((item) => {
    let depth = 0;
    let parent = item.parentCollection;
    const seen = new Set();
    while (parent && byKey.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      depth += 1;
      parent = byKey.get(parent).parentCollection;
    }
    return { ...item, depth: Math.min(depth, 6) };
  });
}

async function loadOptions() {
  refreshButton.disabled = true;
  saveButton.disabled = true;
  collectionSelect.disabled = true;
  setStatus("Carregando coleções da biblioteca pessoal…");
  try {
    const status = await send({ type: "GET_STATUS" });
    if (!status.connected) {
      connectionNotice.classList.remove("hidden");
      settingsPanel.classList.add("hidden");
      setStatus("A conta Zotero ainda não está conectada.", "error");
      return;
    }
    const [settings, result] = await Promise.all([
      send({ type: "GET_SETTINGS" }), send({ type: "GET_COLLECTIONS" })
    ]);
    collectionSelect.replaceChildren();
    const rootOption = document.createElement("option");
    rootOption.value = "";
    rootOption.textContent = "Biblioteca principal (sem coleção)";
    collectionSelect.append(rootOption);
    for (const collection of flattenCollections(result.collections || [])) {
      const option = document.createElement("option");
      option.value = collection.key;
      option.textContent = `${"　".repeat(collection.depth)}${collection.name}`;
      collectionSelect.append(option);
    }
    collectionSelect.value = settings.defaultCollectionKey || "";
    connectionNotice.classList.add("hidden");
    settingsPanel.classList.remove("hidden");
    collectionSelect.disabled = false;
    saveButton.disabled = false;
    setStatus(`Conectado a ${status.username || "sua conta Zotero"}. ${result.collections?.length || 0} coleção(ões) disponíveis.`, "success");
  } catch (error) {
    connectionNotice.classList.add("hidden");
    settingsPanel.classList.remove("hidden");
    setStatus(error.message, "error");
  } finally {
    refreshButton.disabled = false;
  }
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  setStatus("Salvando preferência…");
  try {
    const result = await send({ type: "SET_DEFAULT_COLLECTION", collectionKey: collectionSelect.value });
    setStatus(`Coleção padrão definida: ${result.defaultCollectionName}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
});

refreshButton.addEventListener("click", loadOptions);
loadOptions();
