document.addEventListener("DOMContentLoaded", function () {
  // Elements for visitor tables and emergency report
  const currentVisitorsTableBody = document.querySelector(
    "#current-visitors-table tbody"
  );
  const allVisitorsTableBody = document.querySelector(
    "#all-visitors-table tbody"
  );
  const staffAttendanceTableBody = document.querySelector(
    "#staff-attendance-table tbody"
  );
  const generateReportBtn = document.getElementById("generate-report-btn");
  const emergencyReportDiv = document.getElementById("emergency-report");
  const reportList = document.getElementById("report-list");
  const submitReportBtn = document.getElementById("submit-report-btn");

  // Elements for Add Staff Modal
  const addStaffBtn = document.getElementById("add-staff-btn");
  const addStaffModal = document.getElementById("add-staff-modal");
  const closeStaffModalBtn = document.getElementById("close-staff-modal");
  const staffNameInput = document.getElementById("staff-name-input");
  const captureStaffBtn = document.getElementById("capture-staff-btn");
  const uploadStaffBtn = document.getElementById("upload-staff-btn");
  const staffFileInput = document.getElementById("staff-file-input");
  const saveStaffBtn = document.getElementById("save-staff-btn");

  // Global variables for visitor and staff sessions.
  let currentVisitor = null;
  let currentVisitorDocId = null;
  let currentStaff = null;
  let stream = null;
  let onboardingData = {};
  let uploadedImage = null;
  let capturedStaffDescriptor = null; // Store captured staff face descriptor

  // Ensure face-api models are loaded only once.
  let modelsLoaded = false;
  async function loadFaceApiModels() {
    if (!modelsLoaded) {
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      await faceapi.nets.faceLandmark68Net.loadFromUri("/models");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
      modelsLoaded = true;
    }
  }

  // Capture a face descriptor for visitor (from #video)
  async function captureFaceDescriptor() {
    await loadFaceApiModels();
    const video = document.getElementById("video");
    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (detection) {
      return Array.from(detection.descriptor);
    }
    return null;
  }

  // Capture a face descriptor for staff (from #staff-video)
  async function captureFaceDescriptorForStaff() {
    await loadFaceApiModels();
    const video = document.getElementById("staff-video");
    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (detection) {
      return Array.from(detection.descriptor);
    }
    return null;
  }

  // Compute Euclidean distance between two arrays.
  function computeEuclideanDistance(arr1, arr2) {
    let sum = 0;
    const len = Math.min(arr1.length, arr2.length);
    for (let i = 0; i < len; i++) {
      const diff = arr1[i] - arr2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  // Utility: show/hide screens.
  function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.classList.remove("active");
    });
    if (screenId) {
      const el = document.getElementById(screenId);
      if (el) {
        el.classList.add("active");
      }
    }
  }

  // ------------- Visitor Functions -------------
  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.getElementById("video");
      video.srcObject = stream;
      setTimeout(simulateFaceRecognition, 3000);
    } catch (err) {
      const errorEl = document.getElementById("camera-error");
      if (errorEl) errorEl.style.display = "block";
      console.error("Camera error:", err);
    }
  }

  async function simulateFaceRecognition() {
    const capturedDescriptor = await captureFaceDescriptor();
    if (!capturedDescriptor) {
      console.error("No face detected");
      return;
    }
    let matchedVisitor = null;
    let bestDistance = 0.3;
    try {
      const querySnapshot = await firebase
        .firestore()
        .collection("visitors")
        .get();
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.descriptor && Array.isArray(data.descriptor)) {
          const distance = computeEuclideanDistance(
            capturedDescriptor,
            data.descriptor
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            matchedVisitor = {
              id: doc.id,
              name: data.name,
              descriptor: data.descriptor,
            };
          }
        }
      });
    } catch (error) {
      console.error("Error fetching visitors:", error);
    }
    if (matchedVisitor) {
      currentVisitor = matchedVisitor.name;
      currentVisitorDocId = matchedVisitor.id;
      document.getElementById("visitor-name").innerText = matchedVisitor.name;
      document.getElementById("face-confirmation").style.display = "block";
    } else {
      alert("Face not recognized. Please complete onboarding.");
      showScreen("onboarding-1");
    }
  }

  async function checkInVisitor(data, descriptor) {
    try {
      let fullName,
        extraData = {};
      if (typeof data === "object") {
        fullName = data.firstName + " " + data.lastName;
        extraData = {
          company: data.company,
          reason: data.reason,
          carReg: data.carReg,
        };
      } else {
        fullName = data;
      }
      let visitorDoc;
      const snapshot = await firebase
        .firestore()
        .collection("visitors")
        .where("name", "==", fullName)
        .get();
      if (snapshot.empty) {
        const docRef = await firebase
          .firestore()
          .collection("visitors")
          .add({
            name: fullName,
            descriptor: descriptor,
            ...extraData,
            checkedIn: true,
          });
        visitorDoc = {
          id: docRef.id,
          data: { name: fullName, ...extraData, checkedIn: true },
        };
      } else {
        visitorDoc = { id: snapshot.docs[0].id, data: snapshot.docs[0].data() };
        await firebase
          .firestore()
          .collection("visitors")
          .doc(visitorDoc.id)
          .update({ checkedIn: true });
      }
      await firebase.firestore().collection("signIns").add({
        visitorId: visitorDoc.id,
        timestamp: new Date().toISOString(),
      });
      currentVisitor = fullName;
      currentVisitorDocId = visitorDoc.id;
      document.getElementById("welcome-message").innerText =
        "✅ Welcome, " + fullName + "!";
      showScreen("confirmation-screen");
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      setTimeout(() => {
        showScreen(null);
      }, 3000);
    } catch (error) {
      console.error("Error during check-in:", error);
    }
  }

  async function autoCheckOutVisitor(name) {
    try {
      await firebase
        .firestore()
        .collection("visitors")
        .doc(currentVisitorDocId)
        .update({ checkedIn: false });
      await firebase.firestore().collection("checkOuts").add({
        visitorId: currentVisitorDocId,
        timestamp: new Date().toISOString(),
      });
      alert("✅ " + name + " has been checked out.");
      currentVisitor = null;
      currentVisitorDocId = null;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      showScreen(null);
    } catch (error) {
      console.error("Error during auto check-out:", error);
    }
  }

  // ------------- Staff Functions -------------
  async function startStaffCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.getElementById("staff-video");
      video.srcObject = stream;
      setTimeout(simulateStaffRecognition, 3000);
    } catch (err) {
      const errEl = document.getElementById("staff-camera-error");
      if (errEl) errEl.style.display = "block";
      console.error("Staff camera error:", err);
    }
  }

  async function simulateStaffRecognition() {
    const capturedDescriptor = await captureFaceDescriptorForStaff();
    if (!capturedDescriptor) {
      console.error("No face detected for staff");
      return;
    }
    let matchedStaff = null;
    let bestDistance = 0.3;
    try {
      const querySnapshot = await firebase
        .firestore()
        .collection("staff")
        .get();
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.descriptor && Array.isArray(data.descriptor)) {
          const distance = computeEuclideanDistance(
            capturedDescriptor,
            data.descriptor
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            matchedStaff = {
              id: doc.id,
              name: data.name,
              descriptor: data.descriptor,
            };
          }
        }
      });
    } catch (error) {
      console.error("Error fetching staff:", error);
    }
    if (matchedStaff) {
      currentStaff = matchedStaff;
      document.getElementById("staff-name").innerText = matchedStaff.name;
      document.getElementById("staff-face-confirmation").style.display =
        "block";
    } else {
      // If no matching staff is found, store the captured descriptor and open the registration modal.
      capturedStaffDescriptor = capturedDescriptor;
      alert("Staff face not recognized. Please register new staff.");
      addStaffModal.style.display = "flex";
    }
  }

  async function processStaffEvent(staff) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const snapshot = await firebase
        .firestore()
        .collection("staffEvents")
        .where("staffId", "==", staff.id)
        .where("timestamp", ">=", today.toISOString())
        .where("timestamp", "<", tomorrow.toISOString())
        .orderBy("timestamp", "desc")
        .get();
      let lastEventType = "signOut";
      if (!snapshot.empty) {
        lastEventType = snapshot.docs[0].data().type;
      }
      const newEventType = lastEventType === "signIn" ? "signOut" : "signIn";
      await firebase.firestore().collection("staffEvents").add({
        staffId: staff.id,
        timestamp: new Date().toISOString(),
        type: newEventType,
      });
      alert(
        `Staff ${staff.name} ${
          newEventType === "signIn" ? "signed in" : "signed out"
        }.`
      );
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      showScreen(null);
    } catch (error) {
      console.error("Error processing staff event:", error);
    }
  }

  // ------------- Admin Fetch Functions -------------
  async function fetchCurrentVisitors() {
    try {
      const snapshot = await firebase
        .firestore()
        .collection("visitors")
        .where("checkedIn", "==", true)
        .get();
      currentVisitorsTableBody.innerHTML = "";
      snapshot.forEach((doc) => {
        const data = doc.data();
        const tr = document.createElement("tr");
        const photoTd = document.createElement("td");
        const img = document.createElement("img");
        img.className = "visitor-photo";
        img.src = data.photo || "placeholder.jpg";
        photoTd.appendChild(img);
        tr.appendChild(photoTd);
        const nameTd = document.createElement("td");
        nameTd.innerText = data.name || "";
        tr.appendChild(nameTd);
        const companyTd = document.createElement("td");
        companyTd.innerText = data.company || "";
        tr.appendChild(companyTd);
        const reasonTd = document.createElement("td");
        reasonTd.innerText = data.reason || "";
        tr.appendChild(reasonTd);
        const carTd = document.createElement("td");
        carTd.innerText = data.carReg || "";
        tr.appendChild(carTd);
        const actionTd = document.createElement("td");
        const checkOffBtn = document.createElement("button");
        checkOffBtn.innerText = "Check Off";
        checkOffBtn.classList.add("btn", "btn-danger");
        checkOffBtn.addEventListener("click", async () => {
          await firebase
            .firestore()
            .collection("visitors")
            .doc(doc.id)
            .update({ checkedIn: false });
          fetchCurrentVisitors();
          fetchAllVisitors();
        });
        actionTd.appendChild(checkOffBtn);
        tr.appendChild(actionTd);
        const reportTd = document.createElement("td");
        reportTd.className = "checkbox-cell";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "report-checkbox";
        checkbox.dataset.docId = doc.id;
        reportTd.appendChild(checkbox);
        tr.appendChild(reportTd);
        currentVisitorsTableBody.appendChild(tr);
      });
    } catch (error) {
      console.error("Error fetching current visitors:", error);
    }
  }

  async function fetchAllVisitors() {
    try {
      const snapshot = await firebase.firestore().collection("visitors").get();
      allVisitorsTableBody.innerHTML = "";
      snapshot.forEach((doc) => {
        const data = doc.data();
        const tr = document.createElement("tr");
        const photoTd = document.createElement("td");
        const img = document.createElement("img");
        img.className = "visitor-photo";
        img.src = data.photo || "placeholder.jpg";
        photoTd.appendChild(img);
        tr.appendChild(photoTd);
        const nameTd = document.createElement("td");
        nameTd.innerText = data.name || "";
        tr.appendChild(nameTd);
        const companyTd = document.createElement("td");
        companyTd.innerText = data.company || "";
        tr.appendChild(companyTd);
        const reasonTd = document.createElement("td");
        reasonTd.innerText = data.reason || "";
        tr.appendChild(reasonTd);
        const carTd = document.createElement("td");
        carTd.innerText = data.carReg || "";
        tr.appendChild(carTd);
        const checkedInTd = document.createElement("td");
        checkedInTd.innerText = data.checkedIn ? "Yes" : "No";
        tr.appendChild(checkedInTd);
        allVisitorsTableBody.appendChild(tr);
      });
    } catch (error) {
      console.error("Error fetching all visitors:", error);
    }
  }

  async function fetchStaffAttendance() {
    try {
      const tableBody = staffAttendanceTableBody;
      tableBody.innerHTML = "";
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const snapshot = await firebase
        .firestore()
        .collection("staffEvents")
        .where("timestamp", ">=", today.toISOString())
        .where("timestamp", "<", tomorrow.toISOString())
        .orderBy("timestamp", "asc")
        .get();
      const eventsByStaff = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (!eventsByStaff[data.staffId]) {
          eventsByStaff[data.staffId] = [];
        }
        eventsByStaff[data.staffId].push({
          type: data.type,
          timestamp: new Date(data.timestamp),
        });
      });
      for (const staffId in eventsByStaff) {
        const events = eventsByStaff[staffId];
        const staffDoc = await firebase
          .firestore()
          .collection("staff")
          .doc(staffId)
          .get();
        const staffName = staffDoc.data().name;
        let totalMs = 0;
        for (let i = 0; i < events.length; i++) {
          if (
            events[i].type === "signIn" &&
            events[i + 1] &&
            events[i + 1].type === "signOut"
          ) {
            totalMs += events[i + 1].timestamp - events[i].timestamp;
            i++;
          } else if (events[i].type === "signIn") {
            totalMs += new Date() - events[i].timestamp;
          }
        }
        const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(2);
        let history = "";
        events.forEach((ev) => {
          history += `${ev.type} at ${ev.timestamp.toLocaleTimeString()}<br>`;
        });
        const tr = document.createElement("tr");
        const nameTd = document.createElement("td");
        nameTd.innerText = staffName;
        tr.appendChild(nameTd);
        const historyTd = document.createElement("td");
        historyTd.innerHTML = history;
        tr.appendChild(historyTd);
        const hoursTd = document.createElement("td");
        hoursTd.innerText = totalHours;
        tr.appendChild(hoursTd);
        tableBody.appendChild(tr);
      }
    } catch (error) {
      console.error("Error fetching staff attendance:", error);
    }
  }

  // Emergency Report
  generateReportBtn.addEventListener("click", async () => {
    try {
      const snapshot = await firebase
        .firestore()
        .collection("visitors")
        .where("checkedIn", "==", true)
        .get();
      reportList.innerHTML = "";
      snapshot.forEach((doc) => {
        const data = doc.data();
        const li = document.createElement("li");
        li.innerHTML = `<input type="checkbox" class="report-checkbox" data-doc-id="${doc.id}" /> ${data.name} - ${data.company} - ${data.reason}`;
        reportList.appendChild(li);
      });
      emergencyReportDiv.style.display = "block";
    } catch (error) {
      console.error("Error generating report:", error);
    }
  });
  submitReportBtn.addEventListener("click", async () => {
    const checkboxes = document.querySelectorAll(".report-checkbox");
    const updates = [];
    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        const docId = checkbox.dataset.docId;
        updates.push(
          firebase
            .firestore()
            .collection("visitors")
            .doc(docId)
            .update({ checkedIn: false })
        );
      }
    });
    try {
      await Promise.all(updates);
      alert("Emergency report submitted. Visitors checked off.");
      emergencyReportDiv.style.display = "none";
      fetchCurrentVisitors();
      fetchAllVisitors();
    } catch (error) {
      console.error("Error submitting report:", error);
    }
  });

  // ------------- Add Staff Member Modal Logic -------------
  if (addStaffBtn) {
    addStaffBtn.addEventListener("click", () => {
      addStaffModal.style.display = "flex";
    });
  }
  if (closeStaffModalBtn) {
    closeStaffModalBtn.addEventListener("click", () => {
      addStaffModal.style.display = "none";
    });
  }
  if (uploadStaffBtn) {
    uploadStaffBtn.addEventListener("click", () => {
      staffFileInput.click();
    });
  }
  if (staffFileInput) {
    staffFileInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) {
        uploadedImage = file;
      }
    });
  }
  if (captureStaffBtn) {
    captureStaffBtn.addEventListener("click", async () => {
      showScreen("staff-camera-screen");
      startStaffCamera();
    });
  }
  if (saveStaffBtn) {
    saveStaffBtn.addEventListener("click", async () => {
      const staffName = staffNameInput.value.trim();
      if (!staffName) {
        alert("Please enter the staff member's name.");
        return;
      }
      let descriptor = null;
      if (uploadedImage) {
        const img = await faceapi.bufferToImage(uploadedImage);
        const detection = await faceapi
          .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (detection) {
          descriptor = Array.from(detection.descriptor);
        }
      } else if (capturedStaffDescriptor) {
        descriptor = capturedStaffDescriptor;
      } else {
        descriptor = await captureFaceDescriptorForStaff();
      }
      if (!descriptor) {
        alert("Unable to extract face descriptor. Please try again.");
        return;
      }
      try {
        await firebase.firestore().collection("staff").add({
          name: staffName,
          descriptor: descriptor,
        });
        alert("Staff member added successfully.");
        addStaffModal.style.display = "none";
        staffNameInput.value = "";
        uploadedImage = null;
        staffFileInput.value = "";
        capturedStaffDescriptor = null;
      } catch (error) {
        console.error("Error adding staff member:", error);
        alert("Error adding staff member. Please try again.");
      }
    });
  }

  // ------------- Staff Sign In/Out -------------
  const staffSignInBtn = document.getElementById("staff-sign-in-btn");
  if (staffSignInBtn) {
    staffSignInBtn.addEventListener("click", () => {
      showScreen("staff-camera-screen");
      startStaffCamera();
    });
  }
  const staffYesBtn = document.getElementById("staff-yes-btn");
  if (staffYesBtn) {
    staffYesBtn.addEventListener("click", async () => {
      if (!currentStaff) return;
      processStaffEvent(currentStaff);
    });
  }
  const staffNoBtn = document.getElementById("staff-no-btn");
  if (staffNoBtn) {
    staffNoBtn.addEventListener("click", () => {
      showScreen(null);
    });
  }

  // ------------- Visitor Sign In/Out -------------
  const signInBtn = document.getElementById("sign-in-btn");
  if (signInBtn) {
    signInBtn.addEventListener("click", () => {
      showScreen("camera-screen");
      startCamera();
    });
  }
  const signOutBtn = document.getElementById("sign-out-btn");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", () => {
      if (currentVisitor) {
        autoCheckOutVisitor(currentVisitor);
      } else {
        alert("No visitor is currently signed in.");
      }
    });
  }
  const yesBtn = document.getElementById("yes-btn");
  if (yesBtn) {
    yesBtn.addEventListener("click", async () => {
      const name = document.getElementById("visitor-name").innerText;
      const descriptor = await captureFaceDescriptor();
      if (descriptor) {
        checkInVisitor(name, descriptor);
      }
    });
  }
  const noBtn = document.getElementById("no-btn");
  if (noBtn) {
    noBtn.addEventListener("click", () => {
      showScreen("onboarding-1");
    });
  }

  // ------------- Visitor Onboarding Flow -------------
  const onboarding1Next = document.getElementById("onboarding-1-next");
  if (onboarding1Next) {
    onboarding1Next.addEventListener("click", () => {
      const firstName = document.getElementById("first-name").value.trim();
      if (firstName) {
        onboardingData.firstName = firstName;
        showScreen("onboarding-2");
      } else {
        alert("Please enter your first name.");
      }
    });
  }
  const onboarding2Next = document.getElementById("onboarding-2-next");
  if (onboarding2Next) {
    onboarding2Next.addEventListener("click", () => {
      const lastName = document.getElementById("last-name").value.trim();
      if (lastName) {
        onboardingData.lastName = lastName;
        showScreen("onboarding-3");
      } else {
        alert("Please enter your last name.");
      }
    });
  }
  const onboarding3Next = document.getElementById("onboarding-3-next");
  if (onboarding3Next) {
    onboarding3Next.addEventListener("click", () => {
      const company = document.getElementById("company").value.trim();
      if (company) {
        onboardingData.company = company;
        showScreen("onboarding-4");
      } else {
        alert("Please enter your company.");
      }
    });
  }
  document.querySelectorAll(".reason-btn").forEach((button) => {
    button.addEventListener("click", () => {
      onboardingData.reason = button.getAttribute("data-reason");
      showScreen("onboarding-5");
    });
  });
  const onboarding5Finish = document.getElementById("onboarding-5-finish");
  if (onboarding5Finish) {
    onboarding5Finish.addEventListener("click", () => {
      const carReg = document.getElementById("car-reg").value.trim();
      onboardingData.carReg = carReg;
      captureFaceDescriptor().then((descriptor) => {
        checkInVisitor(onboardingData, descriptor);
      });
    });
  }

  // ------------- Periodic Refresh -------------
  fetchCurrentVisitors();
  fetchAllVisitors();
  fetchStaffAttendance();
  setInterval(() => {
    fetchCurrentVisitors();
    fetchAllVisitors();
    fetchStaffAttendance();
  }, 60000);
});
