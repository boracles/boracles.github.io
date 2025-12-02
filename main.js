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
});

window.addEventListener("load", () => {
  const video = document.querySelector(".intro-bg-video");
  if (!video) return;

  // 한 번만 실행되도록
  const enablePlay = () => {
    video.play().catch(() => {
      // 실패해도 조용히 무시
    });
    window.removeEventListener("touchstart", enablePlay);
    window.removeEventListener("click", enablePlay);
  };

  // 모바일에서 첫 터치/클릭을 사용자 제스처로 인정
  window.addEventListener("touchstart", enablePlay, { once: true });
  window.addEventListener("click", enablePlay, { once: true });
});
