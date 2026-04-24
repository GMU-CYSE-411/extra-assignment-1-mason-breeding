function noteCard(note) { // Create a DOM element for a note card
  const article = document.createElement('article');
  article.className = 'note-card';

  const title = document.createElement('h3');
  title.textContent = note.title;
  article.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'note-meta';
  meta.textContent = `Owner: ${note.ownerUsername} | ID: ${note.id} | Pinned: ${note.pinned}`;
  article.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'note-body';
  body.textContent = note.body;
  article.appendChild(body);

  return article.outerHTML;
}

async function loadNotes(ownerId, search) { //Fetch notes from the sever and render them in the "notes-list" element
  const query = new URLSearchParams();

  if (ownerId) {
    query.set("ownerId", ownerId);
  }

  if (search) {
    query.set("search", search);
  }

  const result = await api(`/api/notes?${query.toString()}`); //Request filitered notes
  const notesList = document.getElementById("notes-list");

  notesList.innerHTML = '';  //clear existing content
  result.notes.forEach(note => notesList.appendChild(noteCard(note)));
}

(async function bootstrapNotes() {
  try {
    const user = await loadCurrentUser();

    if (!user) { //Require login to view notes
      document.getElementById("notes-list").textContent = "Please log in first.";
      return;
    }

    document.getElementById("notes-owner-id").value = user.id;
    document.getElementById("create-owner-id").value = user.id;
    await loadNotes(user.id, "");
  } catch (error) {
    document.getElementById("notes-list").textContent = error.message;
  }
})();

document.getElementById("search-form").addEventListener("submit", async (event) => { 

  const formData = new FormData(event.currentTarget);
  await loadNotes(formData.get("ownerId"), formData.get("search"));
});

document.getElementById("create-note-form").addEventListener("submit", async (event) => { //handle note creation form submission
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const payload = {
    ownerId: formData.get("ownerId"),
    title: formData.get("title"),
    body: formData.get("body"),
    pinned: formData.get("pinned") === "on"
  };

  await api("/api/notes", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  await loadNotes(payload.ownerId, "");
  event.currentTarget.reset();
  document.getElementById("create-owner-id").value = payload.ownerId;
});
