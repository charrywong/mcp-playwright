import { resetBrowserState } from "../../toolHandler.js";
import { ToolContext, ToolResponse, createErrorResponse, createSuccessResponse } from "../common/types.js";
import { BrowserToolBase } from "./base.js";
import {ElementHandle} from "playwright";

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
          'Browser is not connected. The connection has been reset - please retry your navigation.'
      );
    }

    if (!context.page || context.page.isClosed()) {
      return createErrorResponse(
          'Page is not available or has been closed. Please retry your navigation.'
      );
    }

    return this.safeExecute(context, async (page) => {
      const result = await page.evaluate(() => {
        const excludedTags = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK']);
        const textIgnoreTags = new Set([])
        const iconKeywords = ['add', 'delete', 'edit', 'close', 'more'];
        const blackListParentTags = ['d-editor', '.devui-header-app-extra-header', '.dp-first-header', '.dp-second-sidebar', '.devui-right-sidebar-menu'];
        const whiteLiseParentTags = [];

        const results: Array<{ id: string; text: string }> = [];
        let idCounter = 1; // 从 1 开始编号

        const isInBlackListParentTags = (el: Element): boolean => {
          return blackListParentTags.some(tag => el.closest(tag) !== null);
        };

        const notInWhiteLiseParentTags = (el: Element): boolean => {
          if (whiteLiseParentTags.length === 0) return false;
          return whiteLiseParentTags.every(tag => el.closest(tag) == null);
        };

        const getNormalElementText = (el) => {
          // 普通元素有 placeholder 的场景，兼容quill
          const text =  el.getAttribute('placeholder')?.trim()
              || el.getAttribute('data-placeholder')?.trim()
              || el.getAttribute('name')?.trim()
              || null
          return text ? el.tagName + ':' + text : null;
        };

        const getFormElementText = (el) => {
          // 判断元素是否是表单元素
          const isFormElement = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.nodeName);
          if (isFormElement) {
            const text =  el.getAttribute('title')?.trim()
                || el.getAttribute('id')?.trim()
                || null
            return text ? el.tagName + ':' + text : null;
          }
          return null;
        };

        const getIconKeyword = (classList: DOMTokenList): string | null => {
          for (const cls of classList) {
            if (cls.startsWith('icon-')) {
              for (const keyword of iconKeywords) {
                if (cls.includes(keyword)) {
                  return keyword;
                }
              }
            }
          }
          return null;
        };

        const getDirectText = (el: Element): string | null => {
          // 优先检查文本子节点
          for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
              return node.textContent.trim().slice(0, 10);
            }
          }

          // 两者都没有则返回null
          return null;
        };

        const elements = document.querySelectorAll('body *');

        elements.forEach((el: Element) => {
          if (excludedTags.has(el.tagName)) return;

          let markerText: string | null = null;

          markerText = getNormalElementText(el);

          if (!markerText) {
            markerText = getFormElementText(el);
          }

          if (!markerText) {
            markerText = getIconKeyword(el.classList);
          }

          if (!markerText) {
            if (textIgnoreTags.has(el.tagName)) return;
            if (isInBlackListParentTags(el)) return;
            if (notInWhiteLiseParentTags(el)) return;
            markerText = getDirectText(el);
          }

          if (!markerText) return;

          const id = String(idCounter++);
          el.setAttribute('data-tag-id', id);

          results.push({ id, text: markerText });
        });

        return results;
      });

      // 返回格式简化：id:text
      const resultStr = result.map(r => `${r.id}:${r.text}`).join('\n');

      return createSuccessResponse([
        `Tagged ${result.length} elements with data-tag-id`,
        resultStr
      ]);
    });
  }
}

export class LocatorTool extends BrowserToolBase {
  sanitizeSelectors(result: any): string {
    const selectors: string[] = Array.isArray(result?.selectors)
        ? result.selectors
        : [result?.selector].filter(Boolean);

    if (selectors.length === 0) return '';

    // 判断是否含有不可见/异常字符（控制字符、私有区、特殊符号等）
    const hasBadChars = (sel: string) =>
        /[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF\uFFF0-\uFFFF]/.test(sel);

    // 清理函数：移除掉「控制符、私有区、未定义的特殊字符」
    const cleanSelector = (sel: string) =>
        sel.replace(/[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF\uFFF0-\uFFFF]/gu, '');

    // 检查选择器是否有效（不能有 attr=""）
    const isValid = (sel: string) => !/=\s*""/.test(sel);

    // 1️⃣ 优先返回没有坏字符的 selector
    for (const sel of selectors) {
      if (!hasBadChars(sel) && isValid(sel)) {
        return sel;
      }
    }

    // 2️⃣ 如果都有坏字符 → 清理后尝试
    for (const sel of selectors) {
      const cleaned = cleanSelector(sel);
      if (isValid(cleaned) && cleaned.trim().length > 0) {
        return cleaned;
      }
    }

    // 3️⃣ 全部失败 → fallback
    return selectors[0];
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