async function loadSettings(userId) { // Load user settings from the server and populate the form fields
  const result = await api(`/api/settings?userId=${encodeURIComponent(userId)}`);
  const settings = result.settings;

  document.getElementById("settings-form-user-id").value = settings.userId;
  document.getElementById("settings-user-id").value = settings.userId;

  const form = document.getElementById("settings-form");
  form.elements.displayName.value = settings.displayName;
  form.elements.theme.value = settings.theme;
  form.elements.statusMessage.value = settings.statusMessage;
  form.elements.emailOptIn.checked = Boolean(settings.emailOptIn);
  const previewDiv = document.getElementById("status-preview");
  previewDiv.innerHTML = ''; // Clear existing content
  
  // Use DOM creation instead of innerHTML to prevent script injection
  const namePara = document.createElement('p');
  const nameStrong = document.createElement('strong');
  nameStrong.textContent = settings.displayName;
  namePara.appendChild(nameStrong);
  previewDiv.appendChild(namePara);

  const messagePara = document.createElement('p');
  messagePara.textContent = settings.statusMessage;
  previewDiv.appendChild(messagePara);

  writeJson("settings-output", settings);
}
//initialize the setting page on load
(async function bootstrapSettings() {
  try {
    const user = await loadCurrentUser();

    if (!user) { //require login to view settings
      writeJson("settings-output", { error: "Please log in first." });
      return;
    }

    await loadSettings(user.id); //Load the current user's settings
  } catch (error) {
    writeJson("settings-output", { error: error.message });
  }
})();

document.getElementById("settings-query-form").addEventListener("submit", async (event) => { //Handle settings update form submission
  event.preventDefault();
  const formData = new FormData(event.currentTarget); //Build payload from form data
  await loadSettings(formData.get("userId"));
});

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(event.currentTarget); //Build payload from form data
  const payload = {
    userId: formData.get("userId"),
    displayName: formData.get("displayName"),
    theme: formData.get("theme"),
    statusMessage: formData.get("statusMessage"),
    emailOptIn: formData.get("emailOptIn") === "on"
  };

  const result = await api("/api/settings", { //Send updated settings to the server
    method: "POST",
    body: JSON.stringify(payload)
  });

  writeJson("settings-output", result);
  await loadSettings(payload.userId); //reload settings to reflect any changes made by the server
});

document.getElementById("enable-email").addEventListener("click", async () => {
  const result = await api("/api/settings/toggle-email?enabled=1");
  writeJson("settings-output", result);
});

document.getElementById("disable-email").addEventListener("click", async () => {
  const result = await api("/api/settings/toggle-email?enabled=0");
  writeJson("settings-output", result);
});
