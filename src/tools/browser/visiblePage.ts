import {resetBrowserState} from "../../toolHandler.js";
import {createErrorResponse, createSuccessResponse, ToolContext, ToolResponse} from "../common/types.js";
import {BrowserToolBase} from "./base.js";
import {ElementHandle} from "playwright";
import {existsSync, readFileSync} from "fs"

export interface VisibleTagConfig {
  /** CSS selectors; tags use lowercase ('script', 'style'), containers like '.sidebar' */
  excludedSelectors: string[];
  /** keywords inside class names that start with 'icon-' */
  iconClassKeywords: string[];
  /** max length when taking direct text from a text node */
  directTextMaxLen: number;
  /** special tag names that need explicit handling */
  specialTagNames: string[];
}

/** Read VisibleTagTool configuration from VISIBLE_TAG_CONFIG_PATH (required) */
export function readVisibleTagConfig(): VisibleTagConfig {
  const filePath = process.env.VISIBLE_TAG_CONFIG_PATH;
  if (!filePath) {
    throw new Error("VISIBLE_TAG_CONFIG_PATH is not set");
  }

  try {
    if (!existsSync(filePath)) {
      throw new Error(`Config file not found: ${filePath}`);
    }
    const fileContent = readFileSync(filePath, "utf-8");
    const cfg = JSON.parse(fileContent);

    if (
        !Array.isArray(cfg.excludedSelectors) ||
        !Array.isArray(cfg.iconClassKeywords) ||
        !Array.isArray(cfg.specialTagNames)
    ) {
      throw new Error(
          "Invalid config: 'excludedSelectors', 'iconClassKeywords' and 'specialTagNames' must be arrays."
      );
    }

    const directTextMaxLen =
        typeof cfg.directTextMaxLen === "number" && cfg.directTextMaxLen > 0
            ? cfg.directTextMaxLen
            : 10; // 合理兜底（不写死语义，但保证健壮）

    return {
      excludedSelectors: cfg.excludedSelectors,
      iconClassKeywords: cfg.iconClassKeywords,
      specialTagNames: cfg.specialTagNames,
      directTextMaxLen,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error reading VisibleTagTool config:", error);
    throw error;
  }
}

/**
 * Tool for getting the visible text content of the current page
 */
export class VisibleTextTool extends BrowserToolBase {
  /**
   * Execute the visible text page tool
   */
  async execute(args: any, context: ToolContext): Promise<ToolResponse> {
    // Check if browser is available
    if (!context.browser || !context.browser.isConnected()) {
      // If browser is not connected, we need to reset the state to force recreation
      resetBrowserState();
      return createErrorResponse(
        "Browser is not connected. The connection has been reset - please retry your navigation."
      );
    }

    // Check if page is available and not closed
    if (!context.page || context.page.isClosed()) {
      return createErrorResponse(
        "Page is not available or has been closed. Please retry your navigation."
      );
    }
    return this.safeExecute(context, async (page) => {
      try {
        const visibleText = await page!.evaluate(() => {
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                const style = window.getComputedStyle(node.parentElement!);
                return (style.display !== "none" && style.visibility !== "hidden")
                  ? NodeFilter.FILTER_ACCEPT
                  : NodeFilter.FILTER_REJECT;
              },
            }
          );
          let text = "";
          let node;
          while ((node = walker.nextNode())) {
            const trimmedText = node.textContent?.trim();
            if (trimmedText) {
              text += trimmedText + "\n";
            }
          }
          return text.trim();
        });
        // Truncate logic
        const maxLength = typeof args.maxLength === 'number' ? args.maxLength : 20000;
        let output = visibleText;
        let truncated = false;
        if (output.length > maxLength) {
          output = output.slice(0, maxLength) + '\n[Output truncated due to size limits]';
          truncated = true;
        }
        return createSuccessResponse(`Visible text content:\n${output}`);
      } catch (error) {
        return createErrorResponse(`Failed to get visible text content: ${(error as Error).message}`);
      }
    });
  }
}

/**
 * Tool for getting the visible HTML content of the current page
 */
export class VisibleHtmlTool extends BrowserToolBase {
  /**
   * Execute the visible HTML page tool
   */
  async execute(args: any, context: ToolContext): Promise<ToolResponse> {
    // Check if browser is available
    if (!context.browser || !context.browser.isConnected()) {
      // If browser is not connected, we need to reset the state to force recreation
      resetBrowserState();
      return createErrorResponse(
        "Browser is not connected. The connection has been reset - please retry your navigation."
      );
    }

    // Check if page is available and not closed
    if (!context.page || context.page.isClosed()) {
      return createErrorResponse(
        "Page is not available or has been closed. Please retry your navigation."
      );
    }
    return this.safeExecute(context, async (page) => {
      try {
        const { selector, removeComments, removeStyles, removeMeta, minify, cleanHtml } = args;
        // Default removeScripts to true unless explicitly set to false
        const removeScripts = args.removeScripts === false ? false : true;

        // Get the HTML content
        let htmlContent: string;

        if (selector) {
          // If a selector is provided, get only the HTML for that element
          const element = await page.$(selector);
          if (!element) {
            return createErrorResponse(`Element with selector "${selector}" not found`);
          }
          htmlContent = await page.evaluate((el) => el.outerHTML, element);
        } else {
          // Otherwise get the full page HTML
          htmlContent = await page.content();
        }

        // Determine if we need to apply filters
        const shouldRemoveScripts = removeScripts || cleanHtml;
        const shouldRemoveComments = removeComments || cleanHtml;
        const shouldRemoveStyles = removeStyles || cleanHtml;
        const shouldRemoveMeta = removeMeta || cleanHtml;

        // Apply filters in the browser context
        if (shouldRemoveScripts || shouldRemoveComments || shouldRemoveStyles || shouldRemoveMeta || minify) {
          htmlContent = await page.evaluate(
            ({ html, removeScripts, removeComments, removeStyles, removeMeta, minify }) => {
              // Create a DOM parser to work with the HTML
              const parser = new DOMParser();
              const doc = parser.parseFromString(html, 'text/html');

              // Remove script tags if requested
              if (removeScripts) {
                const scripts = doc.querySelectorAll('script');
                scripts.forEach(script => script.remove());
              }

              // Remove style tags if requested
              if (removeStyles) {
                const styles = doc.querySelectorAll('style');
                styles.forEach(style => style.remove());
              }

              // Remove meta tags if requested
              if (removeMeta) {
                const metaTags = doc.querySelectorAll('meta');
                metaTags.forEach(meta => meta.remove());
              }

              // Remove HTML comments if requested
              if (removeComments) {
                const removeComments = (node) => {
                  const childNodes = node.childNodes;
                  for (let i = childNodes.length - 1; i >= 0; i--) {
                    const child = childNodes[i];
                    if (child.nodeType === 8) { // 8 is for comment nodes
                      node.removeChild(child);
                    } else if (child.nodeType === 1) { // 1 is for element nodes
                      removeComments(child);
                    }
                  }
                };
                removeComments(doc.documentElement);
              }

              // Get the processed HTML
              let result = doc.documentElement.outerHTML;

              // Minify if requested
              if (minify) {
                // Simple minification: remove extra whitespace
                result = result.replace(/>\s+</g, '><').trim();
              }

              return result;
            },
            {
              html: htmlContent,
              removeScripts: shouldRemoveScripts,
              removeComments: shouldRemoveComments,
              removeStyles: shouldRemoveStyles,
              removeMeta: shouldRemoveMeta,
              minify
            }
          );
        }

        // Truncate logic
        const maxLength = typeof args.maxLength === 'number' ? args.maxLength : 20000;
        let output = htmlContent;
        if (output.length > maxLength) {
          output = output.slice(0, maxLength) + '\n<!-- Output truncated due to size limits -->';
        }
        return createSuccessResponse(`HTML content:\n${output}`);
      } catch (error) {
        return createErrorResponse(`Failed to get visible HTML content: ${(error as Error).message}`);
      }
    });
  }
}

export class VisibleTagTool extends BrowserToolBase {
  /**
   * Execute the VisibleTagTool to tag valid elements with data-tag-id
   */
  async execute(args: any, context: ToolContext): Promise<ToolResponse> {
    if (!context.browser || !context.browser.isConnected()) {
      resetBrowserState();
      return createErrorResponse(
          "Browser is not connected. The connection has been reset - please retry your navigation."
      );
    }

    if (!context.page || context.page.isClosed()) {
      return createErrorResponse(
          "Page is not available or has been closed. Please retry your navigation."
      );
    }

    const config = readVisibleTagConfig();

    return this.safeExecute(context, async (page) => {
      const result = await page.evaluate((cfg) => {
        const {
          excludedSelectors,
          iconClassKeywords,
          directTextMaxLen,
          specialTagNames,
        } = cfg as {
          excludedSelectors: string[];
          iconClassKeywords: string[];
          directTextMaxLen: number;
          specialTagNames: string[];
        };

        // 命中自身或祖先任一 selector 则认为被排除
        const isExcluded = (el: Element): boolean =>
            excludedSelectors.some((sel) => el.closest(sel) !== null);

        const getSpecialTagText = (el: Element): string | null => {
          const tagName = el.tagName.toUpperCase();
          return specialTagNames.some((t) => t.toUpperCase() === tagName) ? tagName : null;
        };

        /**
         * 尝试从元素的 placeholder/data-placeholder/name 中获取描述
         * 主要用于富文本/占位场景（你之前说的“主要用于带 placeholder 或 name 的特殊元素”）
         * 若命中返回 'TAG:值'，否则返回 null
         */
        const getPlaceholderOrNameText = (el: Element): string | null => {
          // 注意：getAttribute 可能返回 null
          const placeholder =
              (el.getAttribute("placeholder") ||
                  el.getAttribute("data-placeholder") ||
                  "").trim() || null;
          const aria = (el.getAttribute("aria-label") || "").trim() || null;
          const name = (el.getAttribute("name") || "").trim() || null;
          const val = placeholder || aria || name;
          return val ? `${el.tagName}:${val}` : null;
        };

        /**
         * 尝试从表单控件（input/textarea/select）获取描述（title 或 id）
         * 若命中返回 'TAG:值'，否则返回 null
         */
        const getFormControlText = (el: Element): string | null => {
          if (
              el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement ||
              el instanceof HTMLSelectElement
          ) {
            const text =
                (el.getAttribute("title") || "").trim() ||
                (el.getAttribute("id") || "").trim() ||
                null;
            return text ? `${el.tagName}:${text}` : null;
          }
          return null;
        };

        /**
         * 尝试识别 icon 类（类名以 icon- 开头且包含关键词）
         * 若命中返回匹配到的 keyword 字符串，否则返回 null
         */
        const getIconClassText = (el: Element): string | null => {
          for (const cls of el.classList) {
            if (!cls || !cls.startsWith("icon-")) continue;
            for (const kw of iconClassKeywords) {
              if (cls.includes(kw)) return kw;
            }
          }
          return null;
        };

        /**
         * 获取元素的“直系文本节点”并截断（仅直系文本节点，避免深入子树）
         */
        const getDirectText = (el: Element): string | null => {
          const nodes = el.childNodes;
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.nodeType === Node.TEXT_NODE && node.textContent) {
              const t = node.textContent.trim();
              if (t) {
                return t.slice(0, directTextMaxLen);
              }
            }
          }
          return null;
        };

        const isVisible = (el: Element): boolean => {
          if (!(el instanceof HTMLElement)) return false;
          if (el.getClientRects().length === 0) return false;
          const style = getComputedStyle(el);
          return !(
              style.visibility === "hidden" ||
              style.display === "none" ||
              style.opacity === "0"
          );
        };

        const results: Array<{ id: string; text: string }> = [];
        let idCounter = 1;

        // 使用 TreeWalker 遍历所有元素（从 body 的第一个后代开始）
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let el = walker.nextNode() as Element | null;

        while (el) {
          if (!isVisible(el)) {
            el = walker.nextNode() as Element | null;
            continue;
          }

          // 1) 优先尝试三类匹配：placeholder/name、表单控件属性、icon 类
          let markerText: string | null =
              getSpecialTagText(el) ||
              getPlaceholderOrNameText(el) ||
              getFormControlText(el) ||
              getIconClassText(el);

          // 2) 如果前三类都没命中，再看是否被 excluded（命中则跳过），否则取直系文本
          if (!markerText && !isExcluded(el)) {
            markerText = getDirectText(el);
          }

          if (markerText) {
            const id = String(idCounter++);
            try {
              el.setAttribute("data-tag-id", id);
            } catch (err) {
              // 某些元素可能是只读或抛错（防御性处理）
            }
            results.push({ id, text: markerText });
          }

          el = walker.nextNode() as Element | null;
        }

        return results;
      }, config);

      // 返回格式简化：id:text
      const resultStr = result.map((r) => `${r.id}:${r.text}`).join("\n");

      return createSuccessResponse([
        `Tagged ${result.length} elements with data-tag-id`,
        resultStr,
      ]);
    });
  }
}

export class LocatorTool extends BrowserToolBase {
  sanitizeSelectors(result: any): string[] {
    const selectors: string[] = Array.isArray(result?.selectors)
        ? result.selectors
        : [result?.selector].filter(Boolean);

    if (selectors.length === 0) return [];

    // 判断是否含有不可见/异常字符（控制字符、私有区、特殊符号等）
    const hasBadChars = (sel: string) =>
        /[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF\uFFF0-\uFFFF]/.test(sel);

    // 清理函数：移除掉「控制符、私有区、未定义的特殊字符」
    const cleanSelector = (sel: string) =>
        sel.replace(/[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF\uFFF0-\uFFFF]/gu, '');

    // 检查选择器是否有效（不能有 attr=""）
    const isValid = (sel: string) => !/=\s*""/.test(sel);

    // 清理所有 selector
    const cleanedSelectors: string[] = selectors.map(sel => cleanSelector(sel));

    // 选择优先的 selector（无坏字符且合法），或者清理后合法的第一个
    let preferredIndex = selectors.findIndex(sel => !hasBadChars(sel) && isValid(sel));
    if (preferredIndex === -1) {
      preferredIndex = cleanedSelectors.findIndex(sel => isValid(sel) && sel.trim().length > 0);
    }

    // fallback: 如果都不合法，优选就是第一个原始 selector
    if (preferredIndex === -1) preferredIndex = 0;

    // 构建最终数组：优选的放第一位，其余按原始顺序
    return [
      cleanedSelectors[preferredIndex],
      ...cleanedSelectors.filter((_, idx) => idx !== preferredIndex)
    ];
  }

  /**
   * get locator by data-tag-id
   * e.g. 11:新建 => text=\"新建\"
   */
  async execute(args: any, context: ToolContext): Promise<ToolResponse> {
    return this.safeExecute(context, async (page) => {
      const result = await page.evaluate(`
        var e = document.querySelector(\`[data-tag-id='${args.id}']\`);
        ijs.generateSelector(e, {multiple: true});
    `);

      const finalSelector = this.sanitizeSelectors(result);

      let resultStr: string;
      try {
        resultStr = JSON.stringify(finalSelector, null, 2);
      } catch {
        resultStr = String(finalSelector);
      }

      return createSuccessResponse([
        `Tag element locator is:`,
        resultStr
      ]);
    });
  }
}


export class ExpectTextTool extends BrowserToolBase {
  /**
   * Execute the expect text tool
   */
  async execute(args: any, context: ToolContext): Promise<ToolResponse> {
    return this.safeExecute(context, async (page) => {
      if (!args.text) {
        return createErrorResponse("Missing required parameters: text must be provided");
      }

      const elementHandle:  ElementHandle<SVGElement | HTMLElement> = await page.waitForSelector(`text=${args.text}`);

      // 获取元素的文本内容
      const actualText = await elementHandle.textContent();

      return createSuccessResponse(`Successfully located element containing text: "${actualText}"`);
    });
  }
}