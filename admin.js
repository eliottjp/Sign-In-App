document.addEventListener("DOMContentLoaded", function () {
  const db = firebase.firestore();

  // Initialize the search functionality
  initSearch();

  // Sidebar Navigation (Handles page switching)
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
        // Query visitors by "name_lower" for case-insensitive search.
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

        // Attach click event to show previous visits
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

  // ---------------- DISPLAY VISITOR VISITS ----------------
  async function displayVisitorVisits(visitorId) {
    try {
      // Query signIns for all visits of this visitor, ordered by timestamp descending.
      const visitsSnapshot = await db
        .collection("signIns")
        .where("visitorId", "==", visitorId)
        .orderBy("timestamp", "desc")
        .get();

      let visitsHtml = "";
      visitsSnapshot.forEach((doc) => {
        const data = doc.data();
        visitsHtml += `<div class="visit-record" style="margin-bottom:10px;">
                         <p><strong>Date:</strong> ${new Date(
                           data.timestamp
                         ).toLocaleString()}</p>
                         <p><strong>Reason:</strong> ${
                           data.reason || "Not Provided"
                         }</p>
                         <p><strong>Car Reg:</strong> ${
                           data.carReg || "Not Provided"
                         }</p>
                       </div><hr/>`;
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
    // Live count of currently signed-in visitors (from signIns)
    db.collection("signIns").onSnapshot((snapshot) => {
      const currentEl = document.getElementById("dashboard-current");
      if (currentEl) currentEl.innerText = snapshot.docs.length;
    });

    // Total number of visitors (from visitors collection)
    db.collection("visitors").onSnapshot((snapshot) => {
      const totalEl = document.getElementById("dashboard-all");
      if (totalEl) totalEl.innerText = snapshot.size;
    });

    // Currently signed-in staff
    db.collection("staffEvents")
      .where("type", "==", "signIn")
      .onSnapshot((snapshot) => {
        const staffEl = document.getElementById("dashboard-staff");
        if (staffEl) staffEl.innerText = snapshot.size;
      });

    // Recent Check-ins (last 5) with visitor data
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
          if (visitorId) {
            try {
              const visitorDoc = await db
                .collection("visitors")
                .doc(visitorId)
                .get();
              if (visitorDoc.exists) {
                const visitorData = visitorDoc.data();
                name = visitorData.name || "N/A";
              }
            } catch (error) {
              console.error(
                "Error fetching visitor for recent check-in:",
                error
              );
            }
          }
          checkins.innerHTML += `<li>${name} - ${new Date(
            signInData.timestamp
          ).toLocaleTimeString()}</li>`;
        });
      });

    // Staff list for dashboard grid
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
  function fetchCurrentVisitors() {
    // Query all signIns (since signIn documents don’t have a checkedIn field)
    db.collection("signIns")
      .orderBy("timestamp", "desc")
      .onSnapshot((snapshot) => {
        const tbody = document.querySelector("#current-visitors-table tbody");
        tbody.innerHTML = "";

        if (snapshot.empty) {
          tbody.innerHTML =
            "<tr><td colspan='5'>No visitors currently signed in.</td></tr>";
          return;
        }

        snapshot.forEach(async (signInDoc) => {
          const signInData = signInDoc.data();
          const visitorId = signInData.visitorId;
          if (!visitorId) return;

          try {
            const visitorDoc = await db
              .collection("visitors")
              .doc(visitorId)
              .get();
            if (visitorDoc.exists) {
              const visitorData = visitorDoc.data();
              if (visitorData.checkedIn !== true) return;
              tbody.innerHTML += `
                <tr>
                  <td>${visitorData.name || "N/A"}</td>
                  <td>${visitorData.company || "Not Provided"}</td>
                  <td>${signInData.reason || "Not Provided"}</td>
                  <td>${signInData.carReg || "Not Provided"}</td>
                  <td>
                    <button class="btn btn-danger check-out-btn" data-id="${
                      signInDoc.id
                    }" data-visitor-id="${visitorId}">
                      <i class="fa fa-check"></i>
                    </button>
                  </td>
                </tr>
              `;
              attachCheckOutHandlers();
            }
          } catch (error) {
            console.error(
              "Error fetching visitor details for current visitors:",
              error
            );
          }
        });
      });
  }

  // Attach check-out functionality to update visitor document.
  function attachCheckOutHandlers() {
    document.querySelectorAll(".check-out-btn").forEach((button) => {
      button.addEventListener("click", async function () {
        const visitorId = this.getAttribute("data-visitor-id");
        try {
          await db
            .collection("visitors")
            .doc(visitorId)
            .update({ checkedIn: false });
          console.log(`Checked out visitor with visitor ID: ${visitorId}`);
        } catch (error) {
          console.error("Error during check-out:", error);
        }
      });
    });
  }

  // ---------------- ALL VISITORS ----------------
  async function fetchAllVisitors() {
    const tbody = document.querySelector("#all-visitors-table tbody");
    // Clear the table body.
    tbody.innerHTML = "";

    // Get all visitors (order by name, for instance)
    const visitorsSnapshot = await db
      .collection("visitors")
      .orderBy("name")
      .get();
    // Use a for..of loop to handle asynchronous queries for each visitor.
    for (const doc of visitorsSnapshot.docs) {
      const visitorData = doc.data();
      const visitorId = doc.id;
      // Query the signIns collection for the latest check-in for this visitor.
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
      // Append the row for this visitor.
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

    // Attach event listeners for the new buttons.
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
      button.addEventListener("click", function () {
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
            </tr>`;
        });
      });
  }

  // ---------------- EMERGENCY REPORT ----------------
  function generateEmergencyReport() {
    db.collection("signIns")
      .get()
      .then((snapshot) => {
        let reportHTML = `<h3>Emergency Report - ${new Date().toLocaleString()}</h3><ul>`;
        snapshot.forEach((doc) => {
          const data = doc.data();
          reportHTML += `<li>${data.visitorId} (Checked In: ${new Date(
            data.timestamp
          ).toLocaleString()})</li>`;
        });
        reportHTML += `</ul>`;
        document.getElementById("report-output").innerHTML = reportHTML;
      });
  }

  // Initialize dashboard on load
  document.getElementById("dashboard").classList.add("active");
  loadDashboard();
});
