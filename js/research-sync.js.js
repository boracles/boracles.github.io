(async function () {
    const topicConfigs = {
        "ai-audience-backchannels": {
            source: "/notes/ai-audience-backchannels/2026-03-28.html",
        },
    };

    async function loadTopic(topicKey) {
        const config = topicConfigs[topicKey];
        if (!config) return null;

        try {
            const res = await fetch(config.source, { cache: "no-store" });
            if (!res.ok) throw new Error(`Failed to load ${config.source}`);

            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            const titleEl = doc.querySelector("[data-topic-source='title']");

            return {
                title: titleEl ? titleEl.textContent.trim() : "",
            };
        } catch (err) {
            console.error("[research-sync]", err);
            return null;
        }
    }

    async function syncTopic(topicKey) {
        const topic = await loadTopic(topicKey);
        if (!topic) return;

        document
            .querySelectorAll(`[data-topic-target='${topicKey}.title']`)
            .forEach((el) => {
                el.textContent = topic.title;
            });
    }

    const targets = Array.from(document.querySelectorAll("[data-topic-target]"));
    const topicKeys = [...new Set(
        targets.map((el) => el.getAttribute("data-topic-target").split(".")[0])
    )];

    for (const topicKey of topicKeys) {
        await syncTopic(topicKey);
    }
})();