document.addEventListener("DOMContentLoaded", function () {
  const db = firebase.firestore();

  // Global variables
  let currentVisitor = null;
  let currentVisitorDocId = null;
  let stream = null;
  let onboardingData = {}; // To store details: name, reason, carReg, company
  let modelsLoaded = false;

  // Preload face-api models on page load for faster scanning.
  loadFaceApiModels();

  async function loadFaceApiModels() {
    if (!modelsLoaded) {
      console.log("Preloading face-api models...");
      await faceapi.nets.ssdMobilenetv1.loadFromUri("/models");
      await faceapi.nets.faceLandmark68Net.loadFromUri("/models");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
      modelsLoaded = true;
      console.log("Models loaded.");
    }
  }

  // --- Capture Face Descriptor from a Video Element ---
  async function captureFaceDescriptor(videoId) {
    // Assumes models are already loaded.
    const video = document.getElementById(videoId);
    if (!video) {
      console.error("Video element not found:", videoId);
      return null;
    }
    const detection = await faceapi
      .detectSingleFace(video, new faceapi.SsdMobilenetv1Options())
      .withFaceLandmarks()
      .withFaceDescriptor();
    console.log("Detection result for", videoId, ":", detection);
    return detection ? Array.from(detection.descriptor) : null;
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
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.getElementById("video");
      video.srcObject = stream;
      showScreen("camera-screen");
      // Allow a short delay for the camera feed.
      setTimeout(async () => {
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
          // If the visitor is already signed in, prompt them to check out.
          if (matched.checkedIn === true) {
            alert(
              `${matched.name} is already signed in. Please check out instead.`
            );
            showScreen("manual-checkout-screen");
            populateCheckoutSuggestions();
          } else {
            // Proceed with sign in.
            currentVisitor = matched.name;
            currentVisitorDocId = matched.id;
            onboardingData.name = matched.name;
            const visitorNameEl = document.getElementById("visitor-name");
            if (visitorNameEl) visitorNameEl.innerText = matched.name;
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

  async function finishManualSignIn() {
    // Get name from visitor-input and company from visitor-company.
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
    const snapshot = await db
      .collection("visitors")
      .where("name", "==", name)
      .get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      // If already signed in, prompt to check out instead.
      if (data.checkedIn === true) {
        alert(`${name} is already signed in. Please check out instead.`);
        showScreen("manual-checkout-screen");
        populateCheckoutSuggestions();
        return;
      }
      visitorId = doc.id;
      // Update the visitor record with the latest face descriptor and company info.
      const descriptor = await captureFaceDescriptor("video");
      await db.collection("visitors").doc(visitorId).update({
        checkedIn: true,
        descriptor: descriptor,
        company: company,
        name_lower: name.toLowerCase(),
      });
    } else {
      // Create a new visitor record with the current face descriptor.
      const descriptor = await captureFaceDescriptor("video");
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
    showScreen("onboarding-4"); // Proceed to the Reason for Visit step
  }

  // --- Onboarding Flow: Reason for Visit ---
  document.querySelectorAll(".reason-btn").forEach((button) => {
    button.addEventListener("click", () => {
      onboardingData.reason = button.getAttribute("data-reason");
      showScreen("onboarding-5"); // Proceed to Car Registration step
    });
  });

  // --- Onboarding Flow: Car Registration & Complete Sign In ---
  const onboarding5FinishBtn = document.getElementById("onboarding-5-finish");
  if (onboarding5FinishBtn) {
    onboarding5FinishBtn.addEventListener("click", async () => {
      onboardingData.carReg = document.getElementById("car-reg").value.trim();
      // Add a sign in record:
      await db.collection("signIns").add({
        visitorId: currentVisitorDocId,
        timestamp: new Date().toISOString(),
        reason: onboardingData.reason || "",
        carReg: onboardingData.carReg || "",
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
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.getElementById("video");
      video.srcObject = stream;
      showScreen("camera-screen");
      setTimeout(async () => {
        const descriptor = await captureFaceDescriptor("video");
        let matched = null;
        const snapshot = await db.collection("visitors").get();
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.descriptor) {
            const distance = faceapi.euclideanDistance(
              descriptor,
              data.descriptor
            );
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
          // If not signed in, alert that they haven't signed in.
          if (matched.checkedIn !== true) {
            alert(`${matched.name} is not currently signed in.`);
            showScreen("manual-checkout-screen");
            populateCheckoutSuggestions();
          } else {
            currentVisitor = matched.name;
            currentVisitorDocId = matched.id;
            const checkoutNameEl = document.getElementById(
              "checkout-visitor-name"
            );
            if (checkoutNameEl) checkoutNameEl.innerText = matched.name;
            showScreen("checkout-confirmation");
          }
        } else {
          alert("Face not recognized. Please check out manually.");
          showScreen("manual-checkout-screen");
          populateCheckoutSuggestions();
        }
      }, 1000); // Reduced delay for faster scanning.
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

  // --- Always-Visible Skip Button during Scanning ---
  const cameraSkipBtn = document.getElementById("camera-skip-btn");
  if (cameraSkipBtn) {
    cameraSkipBtn.addEventListener("click", () => {
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

  // --- Staff Functions ---
  async function startStaffCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
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
