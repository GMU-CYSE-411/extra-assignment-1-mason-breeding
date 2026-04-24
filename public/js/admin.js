(async function bootstrapAdmin() {
  try {
    const user = await loadCurrentUser(); //load any currently authenticated users

    if (!user) {
      document.getElementById("admin-warning").textContent = "Please log in first.";
      return;
    }

    if (user.role !== "admin") { // If the user is not an admin, show a warning but still attempt to load data
      document.getElementById("admin-warning").textContent =
        "The client says this is not your area, but the page still tries to load admin data.";
    } else {
      document.getElementById("admin-warning").textContent = "Authenticated as admin.";
    }

    const result = await api("/api/admin/users"); //Fetch th list of users from the API
    const tbody = document.getElementById("admin-users");
    tbody.innerHTML = ''; // Clear existing content
    
    // Use DOM creation instead of innerHTML to prevent script injection
    result.users.forEach(entry => {
      const row = document.createElement('tr');
      
      const idCell = document.createElement('td');
      idCell.textContent = entry.id;
      row.appendChild(idCell);
      
      const usernameCell = document.createElement('td');
      usernameCell.textContent = entry.username;
      row.appendChild(usernameCell);
      
      const roleCell = document.createElement('td');
      roleCell.textContent = entry.role;
      row.appendChild(roleCell);
      
      const displayNameCell = document.createElement('td');
      displayNameCell.textContent = entry.displayName;
      row.appendChild(displayNameCell);
      
      const noteCountCell = document.createElement('td');
      noteCountCell.textContent = entry.noteCount;
      row.appendChild(noteCountCell);
      
      tbody.appendChild(row);
    });
  } catch (error) {
    document.getElementById("admin-warning").textContent = error.message;
  }
})();
