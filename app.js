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

  // --- Custom Modal Functions ---
  function showCustomAlert(message, callback) {
    const modal = document.getElementById("custom-modal");
    const modalMessage = document.getElementById("modal-message");
    const modalButtons = document.getElementById("modal-buttons");
    modalMessage.innerText = message;
    modalButtons.innerHTML = `<button id="modal-ok" class="btn">OK</button>`;
    modal.classList.add("active");
    document.getElementById("modal-ok").addEventListener(
      "click",
      function () {
        modal.classList.remove("active");
        if (callback) callback();
      },
      { once: true }
    );
  }

  function showCustomConfirm(message, yesCallback, noCallback) {
    const modal = document.getElementById("custom-modal");
    const modalMessage = document.getElementById("modal-message");
    const modalButtons = document.getElementById("modal-buttons");
    modalMessage.innerText = message;
    modalButtons.innerHTML = `<button id="modal-yes" class="btn">Yes</button><button id="modal-no" class="btn">No</button>`;
    modal.classList.add("active");
    document.getElementById("modal-yes").addEventListener(
      "click",
      function () {
        modal.classList.remove("active");
        if (yesCallback) yesCallback();
      },
      { once: true }
    );
    document.getElementById("modal-no").addEventListener(
      "click",
      function () {
        modal.classList.remove("active");
        if (noCallback) noCallback();
      },
      { once: true }
    );
  }

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
      // Schedule face detection after a brief delay.
      signInTimer = setTimeout(async () => {
        const descriptor = await captureFaceDescriptor("video");
        if (!descriptor) {
          showCustomAlert(
            "No face detected. Please try again or sign in manually.",
            () => {
              showScreen("manual-signin-screen");
              populateVisitorSuggestions();
            }
          );
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
            // Stop the video stream so the scanning animation stops.
            if (stream) {
              stream.getTracks().forEach((track) => track.stop());
              stream = null;
            }
            showCustomConfirm(
              `${latestData.name} is already signed in. Would you like to sign out?`,
              startCheckOutFlow,
              () => {
                showScreen("manual-signin-screen");
                populateVisitorSuggestions();
              }
            );
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
            // Transition to face confirmation screen.
            showScreen("face-confirmation-screen");
          }
        } else {
          showCustomAlert(
            "Face not recognized. Please sign in manually.",
            () => {
              showScreen("manual-signin-screen");
              populateVisitorSuggestions();
            }
          );
        }
      }, 1500);
    } catch (err) {
      const cameraErrorEl = document.getElementById("camera-error");
      if (cameraErrorEl) cameraErrorEl.style.display = "block";
      console.error("Camera error:", err);
    }
  }

  async function finishManualSignIn() {
    const name = document.getElementById("visitor-input").value.trim();
    const company = document.getElementById("visitor-company")
      ? document.getElementById("visitor-company").value.trim()
      : "";
    if (!name) {
      showCustomAlert("Please enter your name.");
      return;
    }
    if (!company) {
      showCustomAlert("Please enter your company.");
      return;
    }
    onboardingData.name = name;
    onboardingData.company = company;
    let visitorId;

    // If the camera stream is not active, start it.
    if (!stream) {
      stream = await getLowResStream();
      const video = document.getElementById("video");
      video.srcObject = stream;
      // Optionally, wait a short moment for the camera to initialize.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Capture face descriptor before updating or creating.
    const descriptor = await captureFaceDescriptor("video");
    if (!descriptor) {
      showCustomAlert(
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
        showCustomConfirm(
          `${name} is already signed in. Would you like to sign out?`,
          startCheckOutFlow,
          () => {}
        );
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
          showCustomAlert(
            "No face detected. Please try again or check out manually.",
            () => {
              showScreen("manual-checkout-screen");
              populateCheckoutSuggestions();
            }
          );
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
            showCustomAlert(
              `${latestData.name} is not currently signed in.`,
              () => {
                showScreen("manual-checkout-screen");
                populateCheckoutSuggestions();
              }
            );
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
            showCustomAlert(
              `✅ ${latestData.name} checked out successfully.`,
              () => {
                showScreen("confirmation-screen");
                setTimeout(() => location.reload(), 3000);
              }
            );
          }
        } else {
          showCustomAlert(
            "Face not recognized. Please check out manually.",
            () => {
              showScreen("manual-checkout-screen");
              populateCheckoutSuggestions();
            }
          );
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
      showCustomAlert("Please enter your name.");
      return;
    }
    const snapshot = await db
      .collection("visitors")
      .where("name", "==", name)
      .get();
    if (snapshot.empty) {
      showCustomAlert("No record found for " + name);
      return;
    }
    const visitorId = snapshot.docs[0].id;
    await db.collection("visitors").doc(visitorId).update({ checkedIn: false });
    await db.collection("checkOuts").add({
      visitorId: visitorId,
      timestamp: new Date().toISOString(),
    });
    showCustomAlert("✅ " + name + " checked out.", () => {
      showScreen("confirmation-screen");
      setTimeout(() => location.reload(), 3000);
    });
  }

  async function processManualCheckout(visitorId) {
    // Retrieve the visitor's document.
    const docSnap = await db.collection("visitors").doc(visitorId).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (data.checkedIn !== true) {
        showCustomAlert(`${data.name} is not currently signed in.`);
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
      showCustomAlert(`✅ ${data.name} checked out successfully.`, () => {
        showScreen("confirmation-screen");
        setTimeout(() => location.reload(), 3000);
      });
    } else {
      showCustomAlert("No record found for the selected visitor.");
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
      showCustomAlert("Staff face not recognized. Please register new staff.");
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
      showCustomAlert(
        `Staff ${staff.name} ${
          newEventType === "signIn" ? "signed in" : "signed out"
        }.`,
        () => {
          if (stream) stream.getTracks().forEach((t) => t.stop());
          showScreen(null);
        }
      );
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

  // --- Confirmation Buttons for Face Confirmation Screen ---
  const confirmBtn = document.getElementById("confirm-btn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      if (currentVisitor) {
        onboardingData.name = currentVisitor;
        showScreen("onboarding-4");
      }
    });
  }
  const notMeBtn = document.getElementById("not-me-btn");
  if (notMeBtn) {
    notMeBtn.addEventListener("click", () => {
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
    try {
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
      if (!html) {
        html = `<div class="suggestion">No matching visitors</div>`;
      }
      container.innerHTML = html;
      container.querySelectorAll(".suggestion").forEach((item) => {
        item.addEventListener("click", async () => {
          const selectedName = item.textContent.split(" (")[0];
          input.value = selectedName;
          container.innerHTML = "";
          const selectedId = item.getAttribute("data-id");
          showCustomConfirm(
            `Do you want to check out ${selectedName}?`,
            async () => {
              await processManualCheckout(selectedId);
            },
            () => {}
          );
        });
      });
    } catch (error) {
      console.error("Error populating checkout suggestions:", error);
    }
  }

  async function processManualCheckout(visitorId) {
    // Retrieve the visitor's document.
    const docSnap = await db.collection("visitors").doc(visitorId).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (data.checkedIn !== true) {
        showCustomAlert(`${data.name} is not currently signed in.`);
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
      showCustomAlert(`✅ ${data.name} checked out successfully.`, () => {
        showScreen("confirmation-screen");
        setTimeout(() => location.reload(), 3000);
      });
    } else {
      showCustomAlert("No record found for the selected visitor.");
    }
  }
});
