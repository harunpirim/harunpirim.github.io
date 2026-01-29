const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { marked } = require("marked");

const ROOT_DIR = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT_DIR, "content");
const TEMPLATE_DIR = path.join(ROOT_DIR, "templates");
const STATIC_DIR = path.join(ROOT_DIR, "static");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const siteTitle = process.env.SITE_TITLE || "Articles";

const repoName = (process.env.GITHUB_REPOSITORY || "").split("/")[1];
const inferredBase =
  repoName && !repoName.endsWith(".github.io") ? `/${repoName}` : "";
const baseUrl = (process.env.BASE_URL || inferredBase).replace(/\/$/, "");

marked.use({ mangle: false, headerIds: false });

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
}

function emptyDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

function walkDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return walkDir(entryPath);
    return entryPath;
  });
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripCodeBlocks(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`]*`/g, "");
}

function extractHashtags(markdown) {
  const text = stripCodeBlocks(markdown);
  const tags = new Set();
  const regex = /(^|[^A-Za-z0-9_])#([A-Za-z0-9][A-Za-z0-9_-]*)/g;
  let match = null;

  while ((match = regex.exec(text))) {
    tags.add(match[2].toLowerCase());
  }

  return Array.from(tags);
}

function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function withBase(pathname) {
  if (!pathname.startsWith("/")) return `${baseUrl}/${pathname}`;
  return `${baseUrl}${pathname}`;
}

function loadTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
}

function renderTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return data[key];
    }
    return "";
  });
}

function parseTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).toLowerCase());
  }
  return String(value)
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function build() {
  emptyDir(DIST_DIR);

  const templates = {
    article: loadTemplate("article.html"),
    topic: loadTemplate("topic.html"),
    index: loadTemplate("index.html"),
  };

  const markdownFiles = walkDir(CONTENT_DIR).filter((filePath) =>
    /\.(md|markdown)$/i.test(filePath)
  );

  const articles = markdownFiles.map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data, content } = matter(raw);
    const stats = fs.statSync(filePath);

    const tags = new Set([
      ...parseTags(data.tags),
      ...extractHashtags(content),
    ]);

    const topicLabel =
      String(data.topic || Array.from(tags)[0] || "general").toLowerCase();

    tags.add(topicLabel);

    const slug = slugify(data.slug || path.parse(filePath).name);
    const topicSlug = slugify(topicLabel) || "general";

    const dateObj = data.date ? new Date(data.date) : new Date(stats.mtime);
    const date = Number.isNaN(dateObj.getTime())
      ? ""
      : dateObj.toISOString().slice(0, 10);

    const summary =
      data.summary || stripMarkdown(content).slice(0, 180).trim();

    const url = withBase(`/${topicSlug}/${slug}/`);

    return {
      title: data.title || slug.replace(/-/g, " "),
      slug,
      topicSlug,
      topicLabel,
      tags: Array.from(tags).sort(),
      date,
      summary,
      contentHtml: marked.parse(content),
      url,
    };
  });

  const sortedArticles = [...articles].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  const tagMap = new Map();

  for (const article of articles) {
    for (const tag of article.tags) {
      const tagSlug = slugify(tag);
      if (!tagMap.has(tagSlug)) {
        tagMap.set(tagSlug, { label: tag, articles: [] });
      }
      tagMap.get(tagSlug).articles.push(article);
    }
  }

  for (const article of articles) {
    const tagsHtml = article.tags
      .map(
        (tag) =>
          `<a class="tag" href="${withBase(`/topics/${slugify(tag)}/`)}">#${escapeHtml(tag)}</a>`
      )
      .join(" ");

    const articleHtml = renderTemplate(templates.article, {
      siteTitle: escapeHtml(siteTitle),
      title: escapeHtml(article.title),
      date: escapeHtml(article.date),
      topicLabel: escapeHtml(article.topicLabel),
      topicSlug: escapeHtml(article.topicSlug),
      tags: tagsHtml,
      content: article.contentHtml,
      baseUrl,
    });

    const outputPath = path.join(
      DIST_DIR,
      article.topicSlug,
      article.slug,
      "index.html"
    );
    writeFile(outputPath, articleHtml);
  }

  const topicsIndex = Array.from(tagMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  for (const [tagSlug, tagInfo] of topicsIndex) {
    const topicArticles = [...tagInfo.articles].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    const articlesHtml = topicArticles
      .map(
        (article) => `<li>
  <a href="${article.url}">${escapeHtml(article.title)}</a>
  <span class="meta">${escapeHtml(article.date)}</span>
  <p class="summary">${escapeHtml(article.summary)}</p>
</li>`
      )
      .join("\n");

    const topicHtml = renderTemplate(templates.topic, {
      siteTitle: escapeHtml(siteTitle),
      topicLabel: escapeHtml(tagInfo.label),
      topicCount: String(topicArticles.length),
      articles: articlesHtml,
      baseUrl,
    });

    writeFile(
      path.join(DIST_DIR, "topics", tagSlug, "index.html"),
      topicHtml
    );
  }

  const latestHtml = sortedArticles
    .slice(0, 10)
    .map(
      (article) => `<li>
  <a href="${article.url}">${escapeHtml(article.title)}</a>
  <span class="meta">${escapeHtml(article.date)}</span>
  <p class="summary">${escapeHtml(article.summary)}</p>
</li>`
    )
    .join("\n");

  const topicsHtml = topicsIndex
    .map(([tagSlug, tagInfo]) => {
      const count = tagInfo.articles.length;
      return `<li>
  <a href="${withBase(`/topics/${tagSlug}/`)}">${escapeHtml(tagInfo.label)}</a>
  <span class="meta">${count} posts</span>
</li>`;
    })
    .join("\n");

  const indexHtml = renderTemplate(templates.index, {
    siteTitle: escapeHtml(siteTitle),
    latest: latestHtml,
    topics: topicsHtml,
    baseUrl,
  });

  writeFile(path.join(DIST_DIR, "index.html"), indexHtml);

  const topicsOverviewHtml = renderTemplate(templates.topic, {
    siteTitle: escapeHtml(siteTitle),
    topicLabel: "Topics",
    topicCount: String(topicsIndex.length),
    articles: topicsHtml,
    baseUrl,
  });

  writeFile(path.join(DIST_DIR, "topics", "index.html"), topicsOverviewHtml);

  if (fs.existsSync(STATIC_DIR)) {
    for (const filePath of walkDir(STATIC_DIR)) {
      const relative = path.relative(STATIC_DIR, filePath);
      const destination = path.join(DIST_DIR, relative);
      writeFile(destination, fs.readFileSync(filePath));
    }
  }
}

build();
