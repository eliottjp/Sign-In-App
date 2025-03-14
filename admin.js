document.addEventListener("DOMContentLoaded", function () {
  const db = firebase.firestore();

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

  // ---------------- DASHBOARD ----------------
  function loadDashboard() {
    // Live count of currently checked-in visitors (from signIns)
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

    // Recent Check-ins (last 5) pulling from signIns and joining visitor data
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

    // Currently signed-in staff list (for the dashboard grid)
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
              // Only display if the visitor document indicates they are currently signed in.
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

  // Attach check-out functionality and update visitor document
  function attachCheckOutHandlers() {
    document.querySelectorAll(".check-out-btn").forEach((button) => {
      button.addEventListener("click", async function () {
        const signInId = this.getAttribute("data-id");
        const visitorId = this.getAttribute("data-visitor-id");
        try {
          // Update the visitor document's checkedIn field to false.
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
  function fetchAllVisitors() {
    db.collection("visitors")
      .orderBy("timestamp", "desc")
      .onSnapshot((snapshot) => {
        const tbody = document.querySelector("#all-visitors-table tbody");
        tbody.innerHTML = "";
        snapshot.forEach((doc) => {
          const data = doc.data();
          tbody.innerHTML += `
            <tr>
              <td>${data.name || "N/A"}</td>
              <td>${
                data.timestamp
                  ? new Date(data.timestamp).toLocaleString()
                  : "N/A"
              }</td>
              <td>
                <button class="btn btn-secondary view-more-btn" data-id="${
                  doc.id
                }">
                  <i class="fa fa-eye"></i>
                </button>
                <button class="btn btn-danger delete-visitor-btn" data-id="${
                  doc.id
                }">
                  <i class="fa fa-trash"></i>
                </button>
              </td>
            </tr>`;
        });

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
            const docId = this.getAttribute("data-id");
            const doc = await db.collection("visitors").doc(docId).get();
            if (doc.exists) {
              showModal(doc.data());
            }
          });
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
