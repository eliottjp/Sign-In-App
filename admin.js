document.addEventListener("DOMContentLoaded", async function () {
  const db = firebase.firestore();

  // Initialize search functionality.
  initSearch();

  // Sidebar Navigation
  document.querySelectorAll(".sidebar nav a").forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      document
        .querySelectorAll(".page")
        .forEach((page) => page.classList.remove("active"));
      document
        .querySelectorAll(".sidebar nav a")
        .forEach((l) => l.classList.remove("active"));
      this.classList.add("active");
      const pageId = this.getAttribute("data-page");
      document.getElementById(pageId).classList.add("active");

      if (pageId === "dashboard") loadDashboard();
      else if (pageId === "current-visitors") fetchCurrentVisitors();
      else if (pageId === "all-visitors") fetchAllVisitors();
      else if (pageId === "staff-attendance") fetchStaffAttendance();
      else if (pageId === "emergency-report") generateEmergencyReport();

      // Show/hide modal buttons based on page.
      const addStaffBtn = document.getElementById("add-staff-btn");
      const preRegisterBtn = document.getElementById("pre-register-btn");
      if (pageId === "staff-attendance") {
        addStaffBtn.style.display = "block";
        preRegisterBtn.style.display = "none";
      } else if (pageId === "all-visitors") {
        preRegisterBtn.style.display = "block";
        addStaffBtn.style.display = "none";
      } else {
        addStaffBtn.style.display = "none";
        preRegisterBtn.style.display = "none";
      }
    });
  });

  // ---------------- SEARCH FUNCTION ----------------
  function initSearch() {
    const searchInput = document.getElementById("search-visitor");
    const resultsContainer = document.getElementById("search-results");

    searchInput.addEventListener("input", async function () {
      const searchTerm = searchInput.value.trim();
      if (!searchTerm) {
        resultsContainer.innerHTML = "";
        return;
      }
      try {
        const visitorsQuery = db
          .collection("visitors")
          .orderBy("name_lower")
          .startAt(searchTerm.toLowerCase())
          .endAt(searchTerm.toLowerCase() + "\uf8ff");
        const snapshot = await visitorsQuery.get();
        let html = "";
        snapshot.forEach((doc) => {
          const data = doc.data();
          html += `<div class="search-result-item" data-id="${
            doc.id
          }" style="cursor:pointer; padding:8px; border-bottom:1px solid #ddd;">
                     <strong>${data.name || "N/A"}</strong>
                     <p>${data.company || "Not Provided"}</p>
                   </div>`;
        });
        resultsContainer.innerHTML =
          html || "<p>No matching visitors found.</p>";
        document.querySelectorAll(".search-result-item").forEach((item) => {
          item.addEventListener("click", function () {
            const visitorId = this.getAttribute("data-id");
            displayVisitorVisits(visitorId);
          });
        });
      } catch (error) {
        console.error("Error searching visitors:", error);
        resultsContainer.innerHTML = "<p>Error retrieving search results.</p>";
      }
    });
  }

  // ---------------- DISPLAY VISITOR VISITS (Modal) ----------------
  async function displayVisitorVisits(visitorId) {
    try {
      const visitsSnapshot = await db
        .collection("signIns")
        .where("visitorId", "==", visitorId)
        .orderBy("timestamp", "desc")
        .get();
      let visitsHtml = "";
      visitsSnapshot.forEach((doc) => {
        const data = doc.data();
        visitsHtml += `<div class="visit-record">
                         <p><strong>Date:</strong> ${new Date(
                           data.timestamp
                         ).toLocaleString()}</p>
                         <p><strong>Reason:</strong> ${
                           data.reason || "Not Provided"
                         }</p>
                         <p><strong>Car Reg:</strong> ${
                           data.carReg || "Not Provided"
                         }</p>
                       </div>`;
      });
      if (!visitsHtml) {
        visitsHtml = "<p>No previous visits found for this visitor.</p>";
      }
      const modal = document.getElementById("visitor-visits-modal");
      const modalContent = document.getElementById("visitor-visits-content");
      modalContent.innerHTML = visitsHtml;
      modal.style.display = "block";
    } catch (error) {
      console.error("Error retrieving visitor visits:", error);
    }
  }

  // ---------------- DASHBOARD ----------------
  function loadDashboard() {
    db.collection("signIns").onSnapshot((snapshot) => {
      const currentEl = document.getElementById("dashboard-current");
      if (currentEl) currentEl.innerText = snapshot.docs.length;
    });
    db.collection("visitors").onSnapshot((snapshot) => {
      const totalEl = document.getElementById("dashboard-all");
      if (totalEl) totalEl.innerText = snapshot.size;
    });
    db.collection("staffEvents")
      .where("type", "==", "signIn")
      .onSnapshot((snapshot) => {
        const staffEl = document.getElementById("dashboard-staff");
        if (staffEl) staffEl.innerText = snapshot.size;
      });
    db.collection("signIns")
      .orderBy("timestamp", "desc")
      .limit(5)
      .onSnapshot((snapshot) => {
        const checkins = document.getElementById("recent-checkins");
        checkins.innerHTML = "";
        snapshot.forEach(async (doc) => {
          const signInData = doc.data();
          const visitorId = signInData.visitorId;
          let name = "N/A";
          let company = "N/A";
          if (visitorId) {
            try {
              const visitorDoc = await db
                .collection("visitors")
                .doc(visitorId)
                .get();
              if (visitorDoc.exists) {
                const visitorData = visitorDoc.data();
                name = visitorData.name || "N/A";
                company = visitorData.company || "Not Provided";
              }
            } catch (error) {
              console.error(
                "Error fetching visitor for recent check-in:",
                error
              );
            }
          }
          checkins.innerHTML += `
            <div class="card">
              <h4>${name}</h4>
              <p>${company}</p>
              <p><small>${new Date(
                signInData.timestamp
              ).toLocaleTimeString()}</small></p>
            </div>
          `;
        });
      });
    db.collection("staffEvents")
      .where("type", "==", "signIn")
      .onSnapshot((snapshot) => {
        const staffList = document.getElementById("staff-signed-in");
        staffList.innerHTML = "";
        snapshot.forEach((doc) => {
          const data = doc.data();
          staffList.innerHTML += `<li>${data.name} - ${new Date(
            data.timestamp
          ).toLocaleTimeString()}</li>`;
        });
      });
  }

  // ---------------- CURRENT VISITORS ----------------
  async function fetchCurrentVisitors() {
    const tbody = document.querySelector("#current-visitors-table tbody");
    tbody.innerHTML = "";
    const visitorsSnapshot = await db
      .collection("visitors")
      .where("checkedIn", "==", true)
      .get();
    for (const doc of visitorsSnapshot.docs) {
      const visitorData = doc.data();
      const visitorId = doc.id;
      const signInsSnapshot = await db
        .collection("signIns")
        .where("visitorId", "==", visitorId)
        .orderBy("timestamp", "desc")
        .limit(1)
        .get();
      let reason = "Not Provided";
      let carReg = "Not Provided";
      let signInTime = "N/A";
      if (!signInsSnapshot.empty) {
        const signInData = signInsSnapshot.docs[0].data();
        reason = signInData.reason || "Not Provided";
        carReg = signInData.carReg || "Not Provided";
        signInTime = new Date(signInData.timestamp).toLocaleString();
      }
      tbody.innerHTML += `
        <tr>
          <td>${visitorData.name || "N/A"}</td>
          <td>${visitorData.company || "Not Provided"}</td>
          <td>${reason}</td>
          <td>${carReg}</td>
          <td>${signInTime}</td>
          <td>
            <button class="btn btn-danger check-out-btn" data-id="${visitorId}">
              <i class="fa fa-check"></i>
            </button>
          </td>
        </tr>
      `;
    }
    document.querySelectorAll(".check-out-btn").forEach((button) => {
      button.addEventListener("click", async function () {
        const visitorId = this.getAttribute("data-id");
        await db
          .collection("visitors")
          .doc(visitorId)
          .update({ checkedIn: false });
        console.log(`Checked out visitor with visitor ID: ${visitorId}`);
      });
    });
  }

  // ---------------- ALL VISITORS ----------------
  async function fetchAllVisitors() {
    const tbody = document.querySelector("#all-visitors-table tbody");
    tbody.innerHTML = "";
    const visitorsSnapshot = await db
      .collection("visitors")
      .orderBy("name")
      .get();
    for (const doc of visitorsSnapshot.docs) {
      const visitorData = doc.data();
      const visitorId = doc.id;
      let lastCheckIn = "N/A";
      const signInsSnapshot = await db
        .collection("signIns")
        .where("visitorId", "==", visitorId)
        .orderBy("timestamp", "desc")
        .limit(1)
        .get();
      if (!signInsSnapshot.empty) {
        lastCheckIn = new Date(
          signInsSnapshot.docs[0].data().timestamp
        ).toLocaleString();
      }
      tbody.innerHTML += `
        <tr>
          <td>${visitorData.name || "N/A"}</td>
          <td>${lastCheckIn}</td>
          <td>
            <button class="btn btn-secondary view-more-btn" data-id="${visitorId}">
              <i class="fa fa-eye"></i>
            </button>
            <button class="btn btn-danger delete-visitor-btn" data-id="${visitorId}">
              <i class="fa fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }
    document.querySelectorAll(".delete-visitor-btn").forEach((button) => {
      button.addEventListener("click", async function () {
        if (confirm("Are you sure you want to delete this visitor?")) {
          await db
            .collection("visitors")
            .doc(this.getAttribute("data-id"))
            .delete();
        }
      });
    });
    document.querySelectorAll(".view-more-btn").forEach((button) => {
      button.addEventListener("click", async function () {
        const visitorId = this.getAttribute("data-id");
        displayVisitorVisits(visitorId);
      });
    });
  }

  // ---------------- STAFF ATTENDANCE ----------------
  function fetchStaffAttendance() {
    db.collection("staffEvents")
      .where("type", "in", ["signIn", "signOut"])
      .onSnapshot((snapshot) => {
        const tbody = document.querySelector("#staff-attendance-table tbody");
        tbody.innerHTML = "";
        snapshot.forEach((doc) => {
          const data = doc.data();
          tbody.innerHTML += `
          <tr>
            <td>${data.name || "N/A"}</td>
            <td>${
              data.type === "signIn" ? "✔ Signed In" : "❌ Signed Out"
            } - ${new Date(data.timestamp).toLocaleTimeString()}</td>
            <td>${data.hoursWorked || "N/A"} hrs</td>
          </tr>
        `;
        });
      });
  }

  // ---------------- EMERGENCY REPORT ----------------
  async function generateEmergencyReport() {
    const visitorsSnapshot = await db.collection("visitors").get();
    let reportHTML = `<h3>Emergency Report - ${new Date().toLocaleString()}</h3><ul>`;
    for (const doc of visitorsSnapshot.docs) {
      const visitorData = doc.data();
      const signInsSnapshot = await db
        .collection("signIns")
        .where("visitorId", "==", doc.id)
        .orderBy("timestamp", "desc")
        .limit(1)
        .get();
      if (!signInsSnapshot.empty) {
        const signInData = signInsSnapshot.docs[0].data();
        reportHTML += `<li>${visitorData.name} (Checked In: ${new Date(
          signInData.timestamp
        ).toLocaleString()})</li>`;
      }
    }
    reportHTML += `</ul>`;
    document.getElementById("report-output").innerHTML = reportHTML;
  }

  // Initialize dashboard on load.
  document.getElementById("dashboard").classList.add("active");
  loadDashboard();
  initSearch();
});

// --------------- Global Functions for Modals & Staff Face Capture ---------------

let staffFaceDescriptor = null;

async function openStaffCaptureForAdd() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 },
    });
    const video = document.getElementById("staff-video");
    video.srcObject = stream;
    document.getElementById("staff-camera-screen").style.display = "block";
    setTimeout(async () => {
      const descriptor = await captureFaceDescriptor("staff-video");
      if (descriptor) {
        staffFaceDescriptor = descriptor;
        alert("Face captured successfully.");
        closeStaffCamera();
      } else {
        alert("Face not detected. Please try again.");
      }
    }, 1500);
  } catch (err) {
    console.error("Error capturing staff face:", err);
  }
}

async function captureFaceDescriptor(videoId) {
  // Make sure the required model is loaded.
  await faceapi.nets.ssdMobilenetv1.loadFromUri("/models");
  const video = document.getElementById(videoId);
  if (!video) {
    console.error("Video element not found:", videoId);
    return null;
  }
  const detection = await faceapi
    .detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 320,
        scoreThreshold: 0.5,
      })
    )
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (detection) {
    console.log(
      "Face detected for",
      videoId,
      "Descriptor:",
      detection.descriptor
    );
    return Array.from(detection.descriptor);
  } else {
    console.warn("No face detected for video:", videoId);
    return null;
  }
}

function closeStaffCamera() {
  const video = document.getElementById("staff-video");
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((track) => track.stop());
  }
  document.getElementById("staff-camera-screen").style.display = "none";
}
window.closeStaffCamera = closeStaffCamera;

function submitStaff() {
  const name = document.getElementById("staff-name-input").value.trim();
  const role = document.getElementById("staff-role-input").value.trim();
  const email = document.getElementById("staff-email-input").value.trim();

  if (!name || !role || !email) {
    alert("Please fill in all fields for staff.");
    return;
  }
  if (!staffFaceDescriptor) {
    alert("Please capture your face using the 'Add Now' button.");
    return;
  }
  firebase
    .firestore()
    .collection("staff")
    .add({
      name: name,
      role: role,
      email: email,
      faceDescriptor: staffFaceDescriptor,
      hasFaceRec: true,
      timestamp: new Date().toISOString(),
    })
    .then(() => {
      alert("Staff " + name + " added successfully.");
      document.getElementById("add-staff-modal").style.display = "none";
      staffFaceDescriptor = null;
    })
    .catch((error) => {
      console.error("Error adding staff: ", error);
      alert("Error adding staff.");
    });
}

function preRegisterVisitor() {
  const name = document.getElementById("pre-visitor-name").value.trim();
  const company = document.getElementById("pre-visitor-company").value.trim();
  const reason = document.getElementById("pre-visitor-reason").value.trim();
  const car = document.getElementById("pre-visitor-car").value.trim();

  if (!name || !company || !reason || !car) {
    alert("Please fill in all fields for visitor pre-registration.");
    return;
  }

  firebase
    .firestore()
    .collection("visitors")
    .add({
      name: name,
      name_lower: name.toLowerCase(),
      company: company,
      reason: reason,
      carReg: car,
      checkedIn: false,
      timestamp: new Date().toISOString(),
    })
    .then(() => {
      alert("Visitor " + name + " pre-registered successfully.");
      document.getElementById("pre-register-modal").style.display = "none";
    })
    .catch((error) => {
      console.error("Error pre-registering visitor: ", error);
      alert("Error pre-registering visitor.");
    });
}

// Expose global functions for inline onclick handlers.
window.addStaff = submitStaff;
window.preRegisterVisitor = preRegisterVisitor;
window.showScreen = function (screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });
  if (screenId) {
    const el = document.getElementById(screenId);
    if (el) el.classList.add("active");
  }
};
