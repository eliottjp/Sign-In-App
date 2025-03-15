document.addEventListener("DOMContentLoaded", async function () {
  const db = firebase.firestore();

  // Global variables
  let currentVisitor = null;
  let currentVisitorDocId = null;
  let stream = null;
  let onboardingData = {}; // Stores name, reason, carReg, company
  let modelsLoaded = false;
  let suggestionDebounceTimer;
  let signInTimer;

  // Preload face-api models on page load.
  await loadFaceApiModels();

  async function loadFaceApiModels() {
    if (!modelsLoaded) {
      console.log("Preloading face-api models...");
      // Load the models for TinyFaceDetector, landmarks and recognition.
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      await faceapi.nets.faceLandmark68Net.loadFromUri("/models");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
      modelsLoaded = true;
      console.log("Models loaded.");
    }
  }

  // Request a low-resolution video stream.
  async function getLowResStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
      });
    } catch (err) {
      console.error("Error getting video stream:", err);
      throw err;
    }
  }

  // --- Capture Face Descriptor from a Video Element ---
  async function captureFaceDescriptor(videoId) {
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
      console.warn(
        "No face detected in captureFaceDescriptor for video:",
        videoId
      );
      return null;
    }
  }

  // --- Utility: Show/Hide Screens ---
  function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.classList.remove("active");
    });
    if (screenId) {
      const el = document.getElementById(screenId);
      if (el) el.classList.add("active");
    }
  }

  // --- Visitor Sign In Flow ---
  async function startSignInFlow() {
    try {
      stream = await getLowResStream();
      const video = document.getElementById("video");
      video.srcObject = stream;
      showScreen("camera-screen");
      // Store the timeout ID in signInTimer.
      signInTimer = setTimeout(async () => {
        const descriptor = await captureFaceDescriptor("video");
        if (!descriptor) {
          alert("No face detected. Please try again or sign in manually.");
          showScreen("manual-signin-screen");
          populateVisitorSuggestions();
          return;
        }
        let matched = null;
        const snapshot = await db.collection("visitors").get();
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.descriptor) {
            const distance = faceapi.euclideanDistance(
              descriptor,
              data.descriptor
            );
            console.log(`Distance for ${data.name}:`, distance);
            if (distance < 0.4) {
              matched = {
                id: doc.id,
                name: data.name,
                checkedIn: data.checkedIn,
              };
            }
          }
        });
        if (matched) {
          // Re-read document to ensure latest status.
          const docRef = await db.collection("visitors").doc(matched.id).get();
          const latestData = docRef.data();
          if (latestData.checkedIn === true) {
            if (
              confirm(
                `${latestData.name} is already signed in. Would you like to sign out?`
              )
            ) {
              startCheckOutFlow();
            }
            return;
          } else {
            // Mark visitor as signed in.
            await db.collection("visitors").doc(matched.id).update({
              checkedIn: true,
              timestamp: new Date().toISOString(),
            });
            currentVisitor = latestData.name;
            currentVisitorDocId = matched.id;
            onboardingData.name = latestData.name;
            const visitorNameEl = document.getElementById("visitor-name");
            if (visitorNameEl) visitorNameEl.innerText = latestData.name;
            const faceConfEl = document.getElementById("face-confirmation");
            if (faceConfEl) faceConfEl.style.display = "block";
          }
        } else {
          alert("Face not recognized. Please sign in manually.");
          showScreen("manual-signin-screen");
          populateVisitorSuggestions();
        }
      }, 1500);
    } catch (err) {
      const cameraErrorEl = document.getElementById("camera-error");
      if (cameraErrorEl) cameraErrorEl.style.display = "block";
      console.error("Camera error:", err);
    }
  }

  // Updated Skip Scan Button Event Handler
  const cameraSkipBtn = document.getElementById("camera-skip-btn");
  if (cameraSkipBtn) {
    cameraSkipBtn.addEventListener("click", () => {
      // Stop the video stream.
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      // Cancel the scheduled face detection.
      clearTimeout(signInTimer);
      // Proceed to manual sign in.
      showScreen("manual-signin-screen");
      populateVisitorSuggestions();
    });
  }

  async function finishManualSignIn() {
    const name = document.getElementById("visitor-input").value.trim();
    const company = document.getElementById("visitor-company")
      ? document.getElementById("visitor-company").value.trim()
      : "";
    if (!name) {
      alert("Please enter your name.");
      return;
    }
    if (!company) {
      alert("Please enter your company.");
      return;
    }
    onboardingData.name = name;
    onboardingData.company = company;
    let visitorId;
    // Capture face descriptor before updating or creating.
    const descriptor = await captureFaceDescriptor("video");
    if (!descriptor) {
      alert(
        "Face not detected. Please ensure your face is visible and try again."
      );
      return;
    }
    const snapshot = await db
      .collection("visitors")
      .where("name", "==", name)
      .get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      if (data.checkedIn === true) {
        if (
          confirm(`${name} is already signed in. Would you like to sign out?`)
        ) {
          startCheckOutFlow();
        }
        return;
      }
      visitorId = doc.id;
      await db.collection("visitors").doc(visitorId).update({
        checkedIn: true,
        descriptor: descriptor,
        company: company,
        name_lower: name.toLowerCase(),
      });
    } else {
      const docRef = await db.collection("visitors").add({
        name: name,
        name_lower: name.toLowerCase(),
        company: company,
        descriptor: descriptor,
        checkedIn: true,
        timestamp: new Date().toISOString(),
      });
      visitorId = docRef.id;
    }
    currentVisitor = name;
    currentVisitorDocId = visitorId;
    showScreen("onboarding-4"); // Proceed to Reason for Visit
  }

  // --- Onboarding Flow: Reason for Visit ---
  document.querySelectorAll(".reason-btn").forEach((button) => {
    button.addEventListener("click", () => {
      onboardingData.reason = button.getAttribute("data-reason");
      showScreen("onboarding-5"); // Proceed to Car Registration
    });
  });

  // --- Onboarding Flow: Car Registration & Complete Sign In ---
  const onboarding5FinishBtn = document.getElementById("onboarding-5-finish");
  if (onboarding5FinishBtn) {
    onboarding5FinishBtn.addEventListener("click", async () => {
      onboardingData.carReg = document.getElementById("car-reg").value.trim();
      // Create a new sign in record.
      const signInDoc = await db.collection("signIns").add({
        visitorId: currentVisitorDocId,
        timestamp: new Date().toISOString(),
        reason: onboardingData.reason || "",
        carReg: onboardingData.carReg || "",
      });
      // Optionally, update the visitor document with a reference:
      await db.collection("visitors").doc(currentVisitorDocId).update({
        currentSignIn: signInDoc.id,
      });
      document.getElementById("welcome-message").innerText =
        "✅ Welcome, " + onboardingData.name + "!";
      showScreen("confirmation-screen");
      setTimeout(() => location.reload(), 3000);
    });
  }

  // --- Visitor Check Out Flow ---
  async function startCheckOutFlow() {
    try {
      stream = await getLowResStream();
      const video = document.getElementById("video");
      video.srcObject = stream;
      showScreen("camera-screen");
      setTimeout(async () => {
        const descriptor = await captureFaceDescriptor("video");
        if (!descriptor) {
          alert("No face detected. Please try again or check out manually.");
          showScreen("manual-checkout-screen");
          populateCheckoutSuggestions();
          return;
        }
        let matched = null;
        const snapshot = await db.collection("visitors").get();
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.descriptor) {
            const distance = faceapi.euclideanDistance(
              descriptor,
              data.descriptor
            );
            console.log(`Checkout distance for ${data.name}:`, distance);
            if (distance < 0.4) {
              matched = {
                id: doc.id,
                name: data.name,
                checkedIn: data.checkedIn,
              };
            }
          }
        });
        if (matched) {
          const docRef = await db.collection("visitors").doc(matched.id).get();
          const latestData = docRef.data();
          console.log("Matched visitor (latest):", latestData);
          if (latestData.checkedIn !== true) {
            alert(`${latestData.name} is not currently signed in.`);
            showScreen("manual-checkout-screen");
            populateCheckoutSuggestions();
          } else {
            // Automatically check out the visitor.
            await db
              .collection("visitors")
              .doc(matched.id)
              .update({ checkedIn: false });
            await db.collection("checkOuts").add({
              visitorId: matched.id,
              timestamp: new Date().toISOString(),
            });
            alert(`✅ ${latestData.name} checked out successfully.`);
            showScreen("confirmation-screen");
            setTimeout(() => location.reload(), 3000);
          }
        } else {
          alert("Face not recognized. Please check out manually.");
          showScreen("manual-checkout-screen");
          populateCheckoutSuggestions();
        }
      }, 1000);
    } catch (err) {
      const cameraErrorEl = document.getElementById("camera-error");
      if (cameraErrorEl) cameraErrorEl.style.display = "block";
      console.error("Camera error:", err);
    }
  }

  async function finishManualCheckOut() {
    const name = document.getElementById("checkout-input").value.trim();
    if (!name) {
      alert("Please enter your name.");
      return;
    }
    const snapshot = await db
      .collection("visitors")
      .where("name", "==", name)
      .get();
    if (snapshot.empty) {
      alert("No record found for " + name);
      return;
    }
    const visitorId = snapshot.docs[0].id;
    await db.collection("visitors").doc(visitorId).update({ checkedIn: false });
    await db.collection("checkOuts").add({
      visitorId: visitorId,
      timestamp: new Date().toISOString(),
    });
    alert("✅ " + name + " checked out.");
    showScreen("confirmation-screen");
    setTimeout(() => location.reload(), 3000);
  }

  // --- Check Out Confirmation Event Listeners ---
  const checkoutConfirmBtn = document.getElementById("checkout-confirm-btn");
  if (checkoutConfirmBtn) {
    checkoutConfirmBtn.addEventListener("click", async () => {
      await db
        .collection("visitors")
        .doc(currentVisitorDocId)
        .update({ checkedIn: false });
      await db.collection("checkOuts").add({
        visitorId: currentVisitorDocId,
        timestamp: new Date().toISOString(),
      });
      alert("✅ " + currentVisitor + " checked out.");
      showScreen("confirmation-screen");
      setTimeout(() => location.reload(), 3000);
    });
  }
  const checkoutSkipBtn = document.getElementById("checkout-skip-btn");
  if (checkoutSkipBtn) {
    checkoutSkipBtn.addEventListener("click", () => {
      showScreen("manual-checkout-screen");
      populateCheckoutSuggestions();
    });
  }

  // --- Confirmation Buttons for Sign In ---
  const confirmBtn = document.getElementById("confirm-btn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      if (currentVisitor) {
        onboardingData.name = currentVisitor;
        showScreen("onboarding-4");
      }
    });
  }
  const skipBtn = document.getElementById("skip-btn");
  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      showScreen("manual-signin-screen");
      populateVisitorSuggestions();
    });
  }

  // --- Kiosk Button Event Listeners ---
  const signInBtn = document.getElementById("sign-in-btn");
  if (signInBtn) {
    signInBtn.addEventListener("click", startSignInFlow);
  }
  const finishSignInBtn = document.getElementById("finish-signin-btn");
  if (finishSignInBtn) {
    finishSignInBtn.addEventListener("click", finishManualSignIn);
  }
  const checkOutBtn = document.getElementById("check-out-btn");
  if (checkOutBtn) {
    checkOutBtn.addEventListener("click", startCheckOutFlow);
  }
  const finishCheckOutBtn = document.getElementById("finish-checkout-btn");
  if (finishCheckOutBtn) {
    finishCheckOutBtn.addEventListener("click", finishManualCheckOut);
  }

  // --- Real-Time Suggestion Functions for Manual Sign In & Check Out ---
  async function populateVisitorSuggestions() {
    const input = document.getElementById("visitor-input");
    const container = document.getElementById("visitor-suggestions-container");
    if (!input || !container) return;
    const term = input.value.trim().toLowerCase();
    if (!term) {
      container.innerHTML = "";
      return;
    }
    const querySnapshot = await db
      .collection("visitors")
      .orderBy("name_lower")
      .startAt(term)
      .endAt(term + "\uf8ff")
      .get();
    let html = "";
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      html += `<div class="suggestion" data-id="${doc.id}">${data.name} (${
        data.company || "No Company"
      })</div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll(".suggestion").forEach((item) => {
      item.addEventListener("click", async () => {
        const selectedName = item.textContent.split(" (")[0];
        input.value = selectedName;
        container.innerHTML = "";
        const selectedId = item.getAttribute("data-id");
        const docSnap = await db.collection("visitors").doc(selectedId).get();
        if (docSnap.exists) {
          const data = docSnap.data();
          onboardingData.name = data.name;
          onboardingData.company = data.company;
          currentVisitor = data.name;
          currentVisitorDocId = docSnap.id;
          // Proceed to checkout flow (face scan) for automatic check-out.
          showScreen("camera-screen");
          startCheckOutFlow();
        }
      });
    });
  }

  async function populateCheckoutSuggestions() {
    const input = document.getElementById("checkout-input");
    const container = document.getElementById("checkout-suggestions-container");
    if (!input || !container) return;
    const term = input.value.trim().toLowerCase();
    if (!term) {
      container.innerHTML = "";
      return;
    }
    // Only query visitors that are currently checked in.
    const querySnapshot = await db
      .collection("visitors")
      .where("checkedIn", "==", true)
      .orderBy("name_lower")
      .startAt(term)
      .endAt(term + "\uf8ff")
      .get();
    let html = "";
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      html += `<div class="suggestion" data-id="${doc.id}">${data.name} (${
        data.company || "No Company"
      })</div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll(".suggestion").forEach((item) => {
      item.addEventListener("click", async () => {
        const selectedName = item.textContent.split(" (")[0];
        input.value = selectedName;
        container.innerHTML = "";
        const selectedId = item.getAttribute("data-id");
        if (confirm(`Do you want to check out ${selectedName}?`)) {
          await processManualCheckout(selectedId);
        }
      });
    });
  }

  async function processManualCheckout(visitorId) {
    // Retrieve the visitor's document.
    const docSnap = await db.collection("visitors").doc(visitorId).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (data.checkedIn !== true) {
        alert(`${data.name} is not currently signed in.`);
        return;
      }
      // Update the visitor's document to mark them as signed out.
      await db
        .collection("visitors")
        .doc(visitorId)
        .update({ checkedIn: false });
      // Create a checkout record in Firestore.
      await db.collection("checkOuts").add({
        visitorId: visitorId,
        timestamp: new Date().toISOString(),
      });
      alert(`✅ ${data.name} checked out successfully.`);
      showScreen("confirmation-screen");
      setTimeout(() => location.reload(), 3000);
    } else {
      alert("No record found for the selected visitor.");
    }
  }

  // Attach suggestion listeners for manual sign in.
  const visitorInput = document.getElementById("visitor-input");
  if (visitorInput) {
    visitorInput.addEventListener("input", () => {
      clearTimeout(suggestionDebounceTimer);
      suggestionDebounceTimer = setTimeout(populateVisitorSuggestions, 300);
    });
  }
  // Attach suggestion listeners for manual checkout.
  const checkoutInput = document.getElementById("checkout-input");
  if (checkoutInput) {
    checkoutInput.addEventListener("input", () => {
      clearTimeout(suggestionDebounceTimer);
      suggestionDebounceTimer = setTimeout(populateCheckoutSuggestions, 300);
    });
  }

  // --- Staff Functions ---
  async function startStaffCamera() {
    try {
      stream = await getLowResStream();
      const video = document.getElementById("staff-video");
      video.srcObject = stream;
      setTimeout(simulateStaffRecognition, 2000);
    } catch (err) {
      const staffCameraError = document.getElementById("staff-camera-error");
      if (staffCameraError) staffCameraError.style.display = "block";
      console.error("Staff camera error:", err);
    }
  }

  async function simulateStaffRecognition() {
    const capturedDescriptor = await captureFaceDescriptor("staff-video");
    if (!capturedDescriptor) {
      console.error("No face detected for staff");
      return;
    }
    let matchedStaff = null;
    let bestDistance = 0.3;
    try {
      const querySnapshot = await db.collection("staff").get();
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.descriptor) {
          const distance = faceapi.euclideanDistance(
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
      const staffNameEl = document.getElementById("staff-name");
      if (staffNameEl) staffNameEl.innerText = matchedStaff.name;
      const staffFaceConf = document.getElementById("staff-face-confirmation");
      if (staffFaceConf) staffFaceConf.style.display = "block";
    } else {
      alert("Staff face not recognized. Please register new staff.");
      showScreen("add-staff-modal");
    }
  }

  async function processStaffEvent(staff) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const snapshot = await db
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
      await db.collection("staffEvents").add({
        staffId: staff.id,
        timestamp: new Date().toISOString(),
        type: newEventType,
      });
      alert(
        `Staff ${staff.name} ${
          newEventType === "signIn" ? "signed in" : "signed out"
        }.`
      );
      if (stream) stream.getTracks().forEach((t) => t.stop());
      showScreen(null);
    } catch (error) {
      console.error("Error processing staff event:", error);
    }
  }

  // --- Staff Event Listeners ---
  const staffSignInBtn = document.getElementById("staff-sign-in-btn");
  if (staffSignInBtn) {
    staffSignInBtn.addEventListener("click", () => {
      showScreen("staff-camera-screen");
      startStaffCamera();
    });
  }
  const staffConfirmBtn = document.getElementById("staff-confirm-btn");
  if (staffConfirmBtn) {
    staffConfirmBtn.addEventListener("click", async () => {
      if (!currentStaff) return;
      processStaffEvent(currentStaff);
    });
  }
  const staffSkipBtn = document.getElementById("staff-skip-btn");
  if (staffSkipBtn) {
    staffSkipBtn.addEventListener("click", () => {
      showScreen(null);
    });
  }
});
