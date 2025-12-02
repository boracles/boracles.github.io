document.addEventListener("DOMContentLoaded", () => {
  gsap.registerPlugin(ScrollTrigger);

  // 모든 패널 스냅(섹션 간 '툭툭' 걸리는 느낌)
  const panels = gsap.utils.toArray(".panel");
  ScrollTrigger.create({
    trigger: ".wrapper",
    start: "top top",
    end: () => "+=" + (panels.length - 1) * window.innerHeight,
    snap: 1 / (panels.length - 1),
  });

  // Intro 텍스트 페이드 인
  gsap.from(".intro-title", {
    opacity: 0,
    y: 40,
    duration: 1.3,
    ease: "power3.out",
  });
  gsap.from(".intro-tagline", {
    opacity: 0,
    y: 20,
    duration: 1.3,
    delay: 0.3,
    ease: "power3.out",
  });

  // ABOUT 패널 – 텍스트 위로 슬라이드
  gsap.from(".about-text", {
    scrollTrigger: {
      trigger: ".panel--about",
      start: "top 80%",
    },
    opacity: 0,
    y: 40,
    duration: 1.1,
    ease: "power2.out",
  });

  // CAPABILITIES – 하나씩 스태거 등장
  gsap.from(".cap-item", {
    scrollTrigger: {
      trigger: ".panel--caps",
      start: "top 80%",
    },
    opacity: 0,
    y: 30,
    duration: 0.8,
    stagger: 0.12,
    ease: "power2.out",
  });

  // PROJECT TIMELINE – 세로 라인 따라 위에서 아래로
  gsap.from(".timeline-item", {
    scrollTrigger: {
      trigger: ".panel--timeline",
      start: "top 75%",
    },
    opacity: 0,
    y: 40,
    duration: 0.9,
    stagger: 0.12,
    ease: "power2.out",
  });

  // AI Audience 상세 패널 – 왼/오른쪽에서 슬라이드
  gsap.from(".ai-left", {
    scrollTrigger: {
      trigger: ".panel--ai",
      start: "top 75%",
    },
    opacity: 0,
    x: -40,
    duration: 1,
    ease: "power2.out",
  });

  gsap.from(".ai-right", {
    scrollTrigger: {
      trigger: ".panel--ai",
      start: "top 75%",
    },
    opacity: 0,
    x: 40,
    duration: 1,
    delay: 0.1,
    ease: "power2.out",
  });

  // TEACHING 패널 – 카드 스태거
  gsap.from(".teach-card", {
    scrollTrigger: {
      trigger: ".panel--teach",
      start: "top 80%",
    },
    opacity: 0,
    y: 30,
    duration: 0.8,
    stagger: 0.1,
    ease: "power2.out",
  });

  // CONTACT 패널 – 위에서 살짝 떨어지는 느낌
  gsap.from(".contact-inner", {
    scrollTrigger: {
      trigger: ".panel--contact",
      start: "top 80%",
    },
    opacity: 0,
    y: 30,
    duration: 1,
    ease: "power2.out",
  });

  // ============================
  // NAV 활성 상태(is-active) 처리
  // ============================

  const navLinks = document.querySelectorAll(".nav-right a");
  const sectionIds = ["intro", "about", "projects", "teaching", "contact"];

  function setActiveNav(id) {
    navLinks.forEach((link) => {
      const href = link.getAttribute("href"); // "#about"
      const targetId = href && href.startsWith("#") ? href.substring(1) : null;
      link.classList.toggle("is-active", targetId === id);
    });
  }

  // 스크롤 위치에 따라 활성 메뉴 변경
  sectionIds.forEach((id) => {
    const sectionEl = document.getElementById(id);
    if (!sectionEl) return;

    ScrollTrigger.create({
      trigger: sectionEl,
      start: "top center",
      end: "bottom center",
      onEnter: () => setActiveNav(id),
      onEnterBack: () => setActiveNav(id),
    });
  });

  // 메뉴 클릭 시 바로 is-active 적용 (스크롤 애니메이션 전)
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const href = link.getAttribute("href");
      const targetId = href && href.startsWith("#") ? href.substring(1) : null;
      if (targetId) {
        setActiveNav(targetId);
      }
    });
  });

  // 처음 로드시 intro 활성화
  setActiveNav("intro");

  // 처음 로드시 intro 활성화
  setActiveNav("intro");

  // ============================
  // ABOUT VISUAL (노드 + 라인 필드 + 카메라 반응)
  // ============================
  const aboutCanvas = document.getElementById("aboutCanvas");
  if (aboutCanvas) {
    const ctx = aboutCanvas.getContext("2d");
    let width, height, dpr;
    let nodes = [];
    let mouse = { x: null, y: null };

    // 카메라 관련
    const video = document.getElementById("faceVideo");
    let camCanvas, camCtx;
    let brightness = 0.5; // 0 ~ 1 사이 값으로 유지

    function initCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("카메라를 지원하지 않는 브라우저입니다.");
        return;
      }
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user" }, audio: false })
        .then((stream) => {
          video.srcObject = stream;
          video.play();
        })
        .catch((err) => {
          console.warn("카메라 접근 거부 또는 오류:", err);
        });
    }

    function sampleCamera() {
      // 비디오 준비 안 됐으면 패스
      if (!video || video.readyState < 2) return;

      const w = 64;
      const h = 48;
      if (!camCanvas) {
        camCanvas = document.createElement("canvas");
        camCanvas.width = w;
        camCanvas.height = h;
        camCtx = camCanvas.getContext("2d");
      }

      camCtx.drawImage(video, 0, 0, w, h);
      const img = camCtx.getImageData(0, 0, w, h).data;

      // 중앙 영역만 샘플링 (얼굴이 있을 법한 영역)
      let sum = 0;
      let count = 0;
      const xStart = Math.floor(w * 0.25);
      const xEnd = Math.floor(w * 0.75);
      const yStart = Math.floor(h * 0.25);
      const yEnd = Math.floor(h * 0.75);

      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const idx = (y * w + x) * 4;
          const r = img[idx];
          const g = img[idx + 1];
          const b = img[idx + 2];
          // 간단한 밝기값
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          sum += lum;
          count++;
        }
      }

      if (count > 0) {
        const avg = sum / count; // 0 ~ 255
        let norm = avg / 255; // 0 ~ 1
        // 약간 부드럽게 보정
        brightness = brightness * 0.8 + norm * 0.2;
      }
    }

    function resize() {
      const rect = aboutCanvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      width = rect.width * dpr;
      height = rect.height * dpr;
      aboutCanvas.width = width;
      aboutCanvas.height = height;
      initNodes();
    }

    function initNodes() {
      nodes = [];
      const count = 18;
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
        });
      }
    }

    function drawLineField() {
      const cols = 12;
      const step = width / cols;
      ctx.save();
      // 얼굴 밝기(brightness)에 따라 선 강도 변화
      const alpha = 0.03 + brightness * 0.08; // 0.03 ~ 0.11
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1 * dpr;

      for (let i = 0; i <= cols; i++) {
        const x = i * step;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        const baseAmp = 12 * dpr;
        const amp = baseAmp * (0.5 + brightness); // 얼굴 밝을수록 더 많이 흔들림
        const offset = Math.sin(Date.now() * 0.0004 + i) * amp;
        ctx.lineTo(x + offset, height);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawNodesAndLinks() {
      // 얼굴 밝기에 따라 링크 거리 변화
      const linkDist = (120 + brightness * 150) * dpr; // 어두우면 촘촘, 밝으면 더 멀리 연결
      const nodeRadius = (2 + brightness * 2) * dpr; // 얼굴 밝으면 노드가 조금 커짐

      // 노드 업데이트
      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;

        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;

        // 마우스 근처에서 약간 끌림
        if (mouse.x !== null) {
          const dx = n.x - mouse.x;
          const dy = n.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 220 * dpr) {
            n.x += dx * -0.003;
            n.y += dy * -0.003;
          }
        }
      });

      ctx.save();

      // 링크
      ctx.lineWidth = 1 * dpr;
      nodes.forEach((n, i) => {
        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const dx = n.x - m.x;
          const dy = n.y - m.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < linkDist) {
            const alpha = 1 - dist / linkDist;
            ctx.strokeStyle = `rgba(255,255,255,${0.2 * alpha})`;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
          }
        }
      });

      // 노드
      nodes.forEach((n) => {
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.arc(n.x, n.y, nodeRadius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    }

    function animate() {
      sampleCamera(); // ★ 매 프레임 카메라 정보 업데이트
      ctx.clearRect(0, 0, width, height);
      drawLineField();
      drawNodesAndLinks();
      requestAnimationFrame(animate);
    }

    // 마우스 트래킹
    aboutCanvas.addEventListener("mousemove", (e) => {
      const rect = aboutCanvas.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) * (window.devicePixelRatio || 1);
      mouse.y = (e.clientY - rect.top) * (window.devicePixelRatio || 1);
    });
    aboutCanvas.addEventListener("mouseleave", () => {
      mouse.x = null;
      mouse.y = null;
    });

    window.addEventListener("resize", resize);

    resize();
    initCamera();
    animate();
  }
});

window.addEventListener("load", () => {
  const video = document.querySelector(".intro-bg-video");
  if (!video) return;

  const tryPlay = () => {
    video.muted = true; // iOS에서 확실히 muted 상태로
    const p = video.play();
    if (p && p.catch) {
      p.catch(() => {
        // 자동 재생 실패해도 에러는 무시
      });
    }
  };

  // 1) 페이지 로드 직후 한 번 시도
  tryPlay();

  // 2) 그래도 실패했을 경우를 대비해, 첫 터치/클릭에서 다시 시도
  const enablePlay = () => {
    tryPlay();
    window.removeEventListener("touchstart", enablePlay);
    window.removeEventListener("click", enablePlay);
  };

  window.addEventListener("touchstart", enablePlay, { once: true });
  window.addEventListener("click", enablePlay, { once: true });
});
