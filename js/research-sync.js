(async function () {
    const script = document.currentScript;
    const siteRoot = new URL("../", script.src);

    const noteConfigs = {
        "note-2026-03-30": {
            source: new URL("notes/ai-audience-backchannels/2026-03-30.html", siteRoot).href,
        },
        "note-2026-03-28": {
            source: new URL("notes/ai-audience-backchannels/2026-03-28.html", siteRoot).href,
        },
        "note-2026-03-31": {
            source: new URL("notes/ai-audience-backchannels/2026-03-31.html", siteRoot).href,
        },
    };

    async function loadNote(noteKey) {
        const config = noteConfigs[noteKey];
        if (!config) return null;

        try {
            const res = await fetch(config.source, { cache: "no-store" });
            if (!res.ok) throw new Error(`Failed to load ${config.source}`);

            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            const dateEl = doc.querySelector("[data-note-source='date']");
            const metaEl = doc.querySelector("[data-note-source='meta']");
            const titleEl = doc.querySelector("[data-note-source='title']");
            const summaryEl = doc.querySelector("[data-note-source='summary']");

            return {
                date: dateEl ? dateEl.textContent.trim() : "",
                meta: metaEl ? metaEl.textContent.trim() : "",
                title: titleEl ? titleEl.textContent.trim() : "",
                summary: summaryEl ? summaryEl.textContent.trim() : "",
            };
        } catch (err) {
            console.error("[research-sync]", err);
            return null;
        }
    }

    async function syncNote(noteKey) {
        const note = await loadNote(noteKey);
        if (!note) return;

        document.querySelectorAll(`[data-note-target='${noteKey}.date']`).forEach((el) => {
            el.textContent = note.date;
        });

        document.querySelectorAll(`[data-note-target='${noteKey}.meta']`).forEach((el) => {
            el.textContent = note.meta;
        });

        document.querySelectorAll(`[data-note-target='${noteKey}.title']`).forEach((el) => {
            el.textContent = note.title;
        });

        document.querySelectorAll(`[data-note-target='${noteKey}.summary']`).forEach((el) => {
            el.textContent = note.summary;
        });
    }

    const targets = Array.from(document.querySelectorAll("[data-note-target]"));
    const noteKeys = [...new Set(
        targets.map((el) => el.getAttribute("data-note-target").split(".")[0])
    )];

    for (const noteKey of noteKeys) {
        await syncNote(noteKey);
    }
})();