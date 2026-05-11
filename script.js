const API_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL_NAME = "qwen3.6-plus";
const STORAGE_KEY = "dashscope_api_key";
const THEME_STORAGE_KEY = "study_notes_theme";
const SYSTEM_PROMPT =
  "你是一位专业的学习规划师和笔记整理专家。请根据用户的输入整理出结构清晰的摘要、核心知识点和复习思考题。如果用户提出进一步的修改要求（如更短、转表格等），请严格基于之前的上下文历史进行精修。";

// API Key 只保存在运行时变量和 sessionStorage 中，刷新/关闭会话后由浏览器自行处理。
let apiKey = sessionStorage.getItem(STORAGE_KEY) || "";

// 全局多轮上下文数组：每次请求都会把完整 messages 发给 OpenAI 兼容接口。
let messages = [{ role: "system", content: SYSTEM_PROMPT }];
let toastTimer = null;

const apiKeyInput = document.querySelector("#apiKeyInput");
const saveKeyButton = document.querySelector("#saveKeyButton");
const keyStatus = document.querySelector("#keyStatus");
const noteInput = document.querySelector("#noteInput");
const sendButton = document.querySelector("#sendButton");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const loadingIndicator = document.querySelector("#loadingIndicator");
const errorBox = document.querySelector("#errorBox");
const conversationList = document.querySelector("#conversationList");
const charCount = document.querySelector("#charCount");
const roundCount = document.querySelector("#roundCount");
const copyLastButton = document.querySelector("#copyLastButton");
const copyAllButton = document.querySelector("#copyAllButton");
const exportButton = document.querySelector("#exportButton");
const themeToggleButton = document.querySelector("#themeToggleButton");
const toast = document.querySelector("#toast");
const quickPromptButtons = document.querySelectorAll("[data-prompt]");

init();

function init() {
  configureMarkdown();
  hydrateTheme();
  bindEvents();
  hydrateApiKey();
  renderConversation();
  updateInputStats();
  autoResizeTextarea();
  refreshIcons();
}

function configureMarkdown() {
  if (!window.marked) {
    return;
  }

  marked.setOptions({
    breaks: true,
    gfm: true
  });
}

function bindEvents() {
  saveKeyButton.addEventListener("click", saveApiKey);
  sendButton.addEventListener("click", handleSubmit);
  sampleButton.addEventListener("click", fillSampleNote);
  clearButton.addEventListener("click", clearConversation);
  copyLastButton.addEventListener("click", copyLatestAssistantResult);
  copyAllButton.addEventListener("click", copyAllConversation);
  exportButton.addEventListener("click", exportMarkdown);
  themeToggleButton.addEventListener("click", toggleTheme);

  quickPromptButtons.forEach((button) => {
    button.addEventListener("click", () => applyQuickPrompt(button.dataset.prompt));
  });

  noteInput.addEventListener("input", () => {
    autoResizeTextarea();
    updateInputStats();
  });

  noteInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      handleSubmit();
    }
  });
}

function hydrateApiKey() {
  if (apiKey) {
    apiKeyInput.value = apiKey;
    updateKeyStatus(true);
  } else {
    updateKeyStatus(false);
  }
}

function saveApiKey() {
  const nextKey = apiKeyInput.value.trim();

  if (!nextKey) {
    showError("请先填写阿里云百炼 API Key。");
    updateKeyStatus(false);
    return;
  }

  apiKey = nextKey;
  sessionStorage.setItem(STORAGE_KEY, apiKey);
  updateKeyStatus(true);
  hideError();
  showToast("API Key 已保存到当前浏览器会话。");
}

function updateKeyStatus(isReady) {
  keyStatus.textContent = isReady ? "已配置" : "未配置";
  keyStatus.classList.toggle("is-ready", isReady);
}

async function handleSubmit() {
  const userContent = noteInput.value.trim();

  if (!apiKey) {
    showError("请先填写并保存阿里云百炼 API Key。");
    apiKeyInput.focus();
    return;
  }

  if (!userContent) {
    showError("请输入需要整理的笔记内容或后续修改建议。");
    noteInput.focus();
    return;
  }

  hideError();
  setLoading(true);

  const userMessage = { role: "user", content: userContent };
  messages.push(userMessage);
  renderConversation();
  noteInput.value = "";
  autoResizeTextarea();
  updateInputStats();

  try {
    // requestCompletion 会发送完整 messages，从而保留连续精修的上下文。
    const assistantContent = await requestCompletion();
    messages.push({ role: "assistant", content: assistantContent });
    renderConversation();
  } catch (error) {
    messages.pop();
    renderConversation();
    showError(getFriendlyErrorMessage(error));
  } finally {
    setLoading(false);
  }
}

async function requestCompletion() {
  // 纯前端直接调用阿里云百炼 OpenAI 兼容接口，不经过任何自建后端或代理。
  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await readErrorText(response);
    const error = new Error(errorText || response.statusText);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const assistantContent = data?.choices?.[0]?.message?.content;

  if (!assistantContent) {
    throw new Error("模型返回内容为空，请稍后重试。");
  }

  return assistantContent;
}

async function readErrorText(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || JSON.stringify(data);
  } catch {
    return response.statusText;
  }
}

function getFriendlyErrorMessage(error) {
  if (error.status === 401 || error.status === 403) {
    return "API Key 鉴权失败，请检查 Key 是否正确，或确认账号是否开通了阿里云百炼服务。";
  }

  if (error.status === 429) {
    return "请求过于频繁或额度不足，请稍后再试。";
  }

  if (error.status >= 500) {
    return "阿里云百炼服务暂时不可用，请稍后重试。";
  }

  return `请求失败：${error.message || "请检查网络连接、API Key 和模型权限后重试。"}`;
}

function renderConversation() {
  // System Prompt 只参与模型上下文，不显示在页面对话流中。
  const visibleMessages = messages.filter((message) => message.role !== "system");
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const userRounds = messages.filter((message) => message.role === "user").length;

  roundCount.textContent = `${userRounds} 轮`;
  copyLastButton.disabled = assistantMessages.length === 0;
  copyAllButton.disabled = visibleMessages.length === 0;
  exportButton.disabled = visibleMessages.length === 0;

  if (visibleMessages.length === 0) {
    conversationList.innerHTML = `
      <div class="empty-state">
        <strong>还没有整理记录</strong>
        <span>配置 API Key 后，输入笔记即可开始。</span>
      </div>
    `;
    return;
  }

  conversationList.innerHTML = "";

  visibleMessages.forEach((message, index) => {
    const messageElement = document.createElement("article");
    messageElement.className = `message ${message.role}`;

    const headerElement = document.createElement("div");
    headerElement.className = "message-header";
    headerElement.innerHTML = `
      <span>${message.role === "user" ? "我的输入 / 修改建议" : "AI 整理的结果"}</span>
      <span>#${index + 1}</span>
    `;

    const bodyElement = document.createElement("div");
    bodyElement.className = "message-body";

    if (message.role === "assistant") {
      bodyElement.innerHTML = renderMarkdown(message.content);
    } else {
      bodyElement.textContent = message.content;
    }

    messageElement.append(headerElement, bodyElement);
    conversationList.appendChild(messageElement);
  });

  conversationList.scrollTop = conversationList.scrollHeight;
}

function renderMarkdown(content) {
  if (!window.marked) {
    return escapeHtml(content).replace(/\n/g, "<br>");
  }

  const rawHtml = marked.parse(content);
  // marked 不负责安全过滤，所以优先使用 DOMPurify 清理后再插入页面。
  return window.DOMPurify ? DOMPurify.sanitize(rawHtml) : rawHtml;
}

function escapeHtml(content) {
  const div = document.createElement("div");
  div.textContent = content;
  return div.innerHTML;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  saveKeyButton.disabled = isLoading;
  sampleButton.disabled = isLoading;
  quickPromptButtons.forEach((button) => {
    button.disabled = isLoading;
  });
  loadingIndicator.hidden = !isLoading;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

function clearConversation() {
  // 清空页面记录的同时重置底层上下文，保留 System Prompt 作为新会话起点。
  messages = [{ role: "system", content: SYSTEM_PROMPT }];
  noteInput.value = "";
  autoResizeTextarea();
  updateInputStats();
  hideError();
  renderConversation();
  showToast("已清空当前对话，可以重新整理。");
}

function autoResizeTextarea() {
  noteInput.style.height = "auto";
  noteInput.style.height = `${noteInput.scrollHeight}px`;
}

function updateInputStats() {
  charCount.textContent = `${noteInput.value.trim().length} 字`;
}

function applyQuickPrompt(prompt) {
  noteInput.value = prompt;
  autoResizeTextarea();
  updateInputStats();
  noteInput.focus();
}

function fillSampleNote() {
  noteInput.value =
    "示例笔记：\n" +
    "主题：细胞呼吸\n" +
    "1. 细胞呼吸是有机物在细胞内氧化分解并释放能量的过程。\n" +
    "2. 有氧呼吸主要发生在线粒体，分为糖酵解、柠檬酸循环、电子传递链。\n" +
    "3. 无氧呼吸能量释放少，常见产物有乳酸或酒精和二氧化碳。\n" +
    "4. ATP 是细胞直接能源物质，考试常考场所、产物、能量差异。";
  autoResizeTextarea();
  updateInputStats();
  noteInput.focus();
  showToast("已填入一段示例笔记。");
}

function getLatestAssistantContent() {
  return [...messages].reverse().find((message) => message.role === "assistant")?.content || "";
}

async function copyLatestAssistantResult() {
  const content = getLatestAssistantContent();
  if (!content) {
    showToast("还没有可复制的 AI 结果。");
    return;
  }

  await copyText(content);
  showToast("最新 AI 结果已复制。");
}

async function copyAllConversation() {
  const content = buildConversationMarkdown();
  if (!content) {
    showToast("还没有可复制的整理记录。");
    return;
  }

  await copyText(content);
  showToast("全部整理记录已复制。");
}

function exportMarkdown() {
  const content = buildConversationMarkdown();
  if (!content) {
    showToast("还没有可导出的整理记录。");
    return;
  }

  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `学习笔记整理-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Markdown 文件已导出。");
}

function buildConversationMarkdown() {
  return messages
    .filter((message) => message.role !== "system")
    .map((message, index) => {
      const title = message.role === "user" ? "我的输入 / 修改建议" : "AI 整理的结果";
      return `## ${index + 1}. ${title}\n\n${message.content}`;
    })
    .join("\n\n---\n\n");
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

function hydrateTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const shouldUseDark = savedTheme ? savedTheme === "dark" : prefersDark;

  document.body.classList.toggle("dark-theme", shouldUseDark);
  updateThemeIcon();
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark-theme");
  localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
  updateThemeIcon();
  refreshIcons();
  showToast(isDark ? "已切换为深色主题。" : "已切换为浅色主题。");
}

function updateThemeIcon() {
  const isDark = document.body.classList.contains("dark-theme");
  themeToggleButton.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}"></i>`;
  themeToggleButton.setAttribute("aria-label", isDark ? "切换浅色主题" : "切换深色主题");
  themeToggleButton.title = isDark ? "切换浅色主题" : "切换深色主题";
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function refreshIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}
