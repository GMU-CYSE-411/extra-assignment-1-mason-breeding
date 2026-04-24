(function setupFixationHelper() {
})();

document.getElementById("login-form").addEventListener("submit", async (event) => { 
  event.preventDefault(); // prevents page reload

  const formData = new FormData(event.currentTarget);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await api("/api/login", { //send login request to the backend API
      method: "POST",
      body: JSON.stringify(payload)
    });

    writeJson("login-output", result); //display the result of the login attempt in the "login-output" element
  } catch (error) {
    writeJson("login-output", { error: error.message });
  }
});
