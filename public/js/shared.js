let cachedCsrfToken  = null; //cache the CSRF token after loading the current user to avoid unnecessary API calls

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const method = (options.method || "GET").toUpperCase(); //Attach CSRF token for state-changing requests
  if (cachedCsrfToken && (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH')) {
    headers['X-CSRF-Token'] = cachedCsrfToken;
  }

  const response = await fetch(path, { //Perform the request with the same-origin credentials to include cookies
    headers,
    credentials: "same-origin",
    ...options
  });
  const isJson = (response.headers.get("content-type") || "").includes("application/json"); //determine if the response is in JSON format
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) { //If the response is not successful, throw an error with the message from the response body if available
    const message = typeof body === "object" && body && body.error ? body.error : response.statusText;
    throw new Error(message);
  }
  
  return body;
}

async function loadCurrentUser() { //Load the current user's information and cache the CSRF token for future requests
  const data = await api("/api/me");
  if (data.user && data.user.csrfToken) {
    cachedCsrfToken = data.user.csrfToken;
  }
  return data.user;
}

function writeJson(elementId, value) {
  const target = document.getElementById(elementId);

  if (target) {
    target.textContent = JSON.stringify(value, null, 2);
  }
}
