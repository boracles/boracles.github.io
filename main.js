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
  const sectionIds = [
    "intro",
    "about",
    "projects",
    "research",
    "teaching",
    "contact",
  ];

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
  // ABOUT VISUAL (노드 + 라인 필드 + 마우스 기반 시스템)
  // ============================
  const aboutCanvas = document.getElementById("aboutCanvas");
  if (aboutCanvas) {
    const ctx = aboutCanvas.getContext("2d");
    let width, height, dpr;
    let nodes = [];

    // 마우스 상태: 위치 + 속도 + "에너지"
    let mouse = {
      x: null,
      y: null,
      prevX: null,
      prevY: null,
      vx: 0,
      vy: 0,
      energy: 0, // 0 ~ 1 근처
    };

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
      const count = 24; // 노드 수 살짝 늘려서 시스템 느낌
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
        });
      }
    }

    function drawLineField(activity) {
      const cols = 12;
      const step = width / cols;
      ctx.save();

      // 마우스 에너지에 따라 선 강도/진동 변화
      const alpha = 0.04 + activity * 0.2; // 0.04 ~ 0.24
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1 * dpr;

      const now = Date.now() * 0.0004;

      for (let i = 0; i <= cols; i++) {
        const x = i * step;
        ctx.beginPath();
        ctx.moveTo(x, 0);

        const baseAmp = 10 * dpr;
        const amp = baseAmp * (0.5 + activity * 1.8); // 움직일수록 크게 요동
        let offsetPhase = now + i;

        // 마우스 근처일수록 더 요동치게
        if (mouse.x !== null) {
          const colCenter = x;
          const distX = Math.abs(colCenter - mouse.x);
          const colInfluence = Math.max(0, 1 - distX / (width * 0.6)); // 가운데/마우스 근처 영향
          offsetPhase += colInfluence * 1.5;
        }

        const offset = Math.sin(offsetPhase) * amp;
        ctx.lineTo(x + offset, height);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawNodesAndLinks(activity) {
      // 활동도에 따라 네트워크 재구성 범위 변화
      const linkDist = (120 + activity * 260) * dpr; // 120 ~ 380
      const nodeRadius = (2 + activity * 4) * dpr; // 2 ~ 6

      // 노드 업데이트
      nodes.forEach((n) => {
        // 기본 드리프트
        n.x += n.vx;
        n.y += n.vy;

        // 경계 반사
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;

        // 약간의 노이즈를 계속 추가 (죽은 시스템처럼 안 보이게)
        n.vx += (Math.random() - 0.5) * 0.02;
        n.vy += (Math.random() - 0.5) * 0.02;

        // 마우스 행위가 만드는 "흐름"에 휘말리기
        if (mouse.x !== null) {
          const dx = n.x - mouse.x;
          const dy = n.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const influenceRadius = (220 + activity * 260) * dpr;

          if (dist < influenceRadius) {
            const normDx = dx / dist;
            const normDy = dy / dist;

            // 1) 마우스 속도 방향으로 끌려가는 성분
            const flowStrength = 0.0025 * activity;
            n.vx += mouse.vx * flowStrength;
            n.vy += mouse.vy * flowStrength;

            // 2) 중심에서 살짝 밀려나는(또는 빨려드는) 성분
            const radialStrength = 0.003 * activity;
            n.x += normDx * radialStrength * dist * 0.1;
            n.y += normDy * radialStrength * dist * 0.1;
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
            const alpha = (1 - dist / linkDist) * (0.3 + activity * 0.4);
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
          }
        }
      });

      // 노드 (중심이 되는 "관계 포인트")
      nodes.forEach((n) => {
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.arc(n.x, n.y, nodeRadius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      // 마우스 주변에 필드 포인트 시각화 (살짝만)
      if (mouse.x !== null) {
        ctx.save();
        const r = (40 + activity * 80) * dpr;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${0.15 + activity * 0.25})`;
        ctx.lineWidth = 1 * dpr;
        ctx.arc(mouse.x, mouse.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    function animate() {
      // 마우스 속도 기반으로 "행위 에너지" 계산
      if (mouse.prevX !== null && mouse.prevY !== null && mouse.x !== null) {
        const dx = mouse.x - mouse.prevX;
        const dy = mouse.y - mouse.prevY;
        const speed = Math.sqrt(dx * dx + dy * dy);

        // 속도 → 0~1 정도로 정규화
        const targetEnergy = Math.max(0, Math.min(1, speed / (20 * dpr)));

        mouse.energy = mouse.energy * 0.85 + targetEnergy * 0.15;
        mouse.vx = dx;
        mouse.vy = dy;
      } else {
        // 움직이지 않을 때는 서서히 식음
        mouse.energy *= 0.9;
      }

      ctx.clearRect(0, 0, width, height);

      const activity = mouse.energy; // 0~1

      drawLineField(activity);
      drawNodesAndLinks(activity);

      // 다음 프레임을 위해 현재 위치 저장
      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;

      requestAnimationFrame(animate);
    }

    // 마우스 트래킹
    aboutCanvas.addEventListener("mousemove", (e) => {
      const rect = aboutCanvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      mouse.x = (e.clientX - rect.left) * scale;
      mouse.y = (e.clientY - rect.top) * scale;
    });

    aboutCanvas.addEventListener("mouseleave", () => {
      mouse.x = null;
      mouse.y = null;
    });

    window.addEventListener("resize", resize);

    resize();
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

  // ============================
  // ABOUT: 오른쪽 비주얼 높이를 왼쪽 텍스트와 맞추기
  // ============================
  function syncAboutHeight() {
    const left = document.querySelector(".about-left");
    const right = document.querySelector(".about-right");
    if (!left || !right) return;

    // 모바일(한 컬럼)일 때는 고정값만 쓰고 높이 동기화 안 함
    if (window.innerWidth <= 880) {
      right.style.height = ""; // JS로 준 값 제거
      return;
    }

    const h = left.getBoundingClientRect().height;
    right.style.height = `${h}px`;
  }

  // 처음 로드시 1번
  syncAboutHeight();
  // 리사이즈할 때마다 다시 맞추기
  window.addEventListener("resize", syncAboutHeight);
});
