import { describe, expect, it } from "vitest";
import { extractBody, extractH1, extractTitle } from "./html-extractors.js";

// 純 HTML 提取單測：由 generic-adapter.test.ts 的 fetchContent describe 中「純提取」
// 斷言下沉而來,改為直接調用提取函數,斷言等價(行為保持,1:1 搬移)。
// 與 SSRF/網路棧零耦合。

describe("html-extractors.extractTitle / extractBody（提取邏輯）", () => {
	it("正文容器嵌套 div：不在首個 </div> 截斷，抓到尾段", () => {
		const html = `<html><head>
			<meta property="og:description" content="短摘要一句" />
		</head><body>
			<div class="post-content">
				<p>正文第一段內容</p>
				<div class="ad-box">廣告</div>
				<p>正文最後一段尾巴</p>
			</div>
		</body></html>`;
		const body = extractBody(html);
		// 括號配平：尾段不被首個 </div>(廣告塊)截斷
		expect(body).toContain("正文第一段內容");
		expect(body).toContain("正文最後一段尾巴");
	});

	it("正文容器存在時優先於 og:description（不再被一句摘要腰斬）", () => {
		const html = `<html><head>
			<meta property="og:description" content="只有一句營銷摘要" />
		</head><body>
			<article class="article-content"><p>完整正文第一段，比摘要長得多</p><p>第二段補充細節</p></article>
		</body></html>`;
		const body = extractBody(html);
		expect(body).toContain("完整正文第一段");
		expect(body).toContain("第二段補充細節");
		expect(body).not.toBe("只有一句營銷摘要");
	});

	it("Security：病態 HTML（~4.8MB、无 > / 无闭合引号 / 多 class= 锚点）不二次方回溯", () => {
		// 旧 openRe 在此输入上 O(N²) 回溯卡死;有界量词修复后应线性、亚秒完成。
		const evil = `<div ${'class="aaaaaaaa'.repeat(300_000)}`;
		const html = `<html><body>${evil}</body></html>`;
		const t0 = Date.now();
		const body = extractBody(html);
		expect(Date.now() - t0).toBeLessThan(3000);
		expect(typeof body).toBe("string");
	});

	it("容器内 HTML 注释里的 <div> 不破坏括号配平（不吞页尾）", () => {
		const html = `<html><body>
			<div class="post-content">正文真內容<!-- <div>注释 --></div>
			<footer>頁尾版權所有2024噪聲不該進正文</footer>
		</body></html>`;
		const body = extractBody(html);
		expect(body).toContain("正文真內容");
		expect(body).not.toContain("頁尾版權所有");
	});

	it("自闭合 <div/> 不让深度计数失衡（不吞页尾）", () => {
		const html = `<html><body>
			<div class="post-content">正文真內容<div/>更多正文</div>
			<footer>頁尾噪聲不該進正文</footer>
		</body></html>`;
		const body = extractBody(html);
		expect(body).toContain("正文真內容");
		expect(body).toContain("更多正文");
		expect(body).not.toContain("頁尾噪聲");
	});

	it("容器未闭合（被截断）→ 不吞页尾，落 og/density 兜底", () => {
		const html = `<html><head>
			<meta property="og:description" content="摘要兜底" />
		</head><body>
			<div class="post-content">正文開頭被截斷
			<footer>頁尾不該被當正文吞掉</footer>`;
		// 配平失败 → 回退 og:description,不把 footer 吞进 body
		expect(extractBody(html)).toBe("摘要兜底");
	});

	it("無 og、無已知容器 → 文本密度兜底聚合 <p> 段落", () => {
		const html = `<html><head><title>標題</title></head><body>
			<nav>導航</nav>
			<p>這是正文第一段，內容足夠長以通過密度門檻判定。</p>
			<p>這是正文第二段，繼續補充事件細節與經過。</p>
		</body></html>`;
		const body = extractBody(html);
		expect(body).toContain("正文第一段");
		expect(body).toContain("正文第二段");
	});

	it("標題優先 og:title，不取站名 h1（避免欄目/站名污染）", () => {
		const html = `<html><head>
			<meta property="og:title" content="明星A出軌事件深度報導" />
			<title>明星A出軌事件深度報導 - 某娛樂網</title>
		</head><body>
			<h1>娛樂頻道</h1>
			<div class="post-content"><p>正文</p></div>
		</body></html>`;
		expect(extractTitle(html)).toBe("明星A出軌事件深度報導");
		// h1 不污染標題
		expect(extractH1(html)).toBe("娛樂頻道");
	});

	it("無 og:title 時退回 <title>，再退回 h1", () => {
		const html = `<html><head><title>真文章標題</title></head><body><h1>站名</h1></body></html>`;
		expect(extractTitle(html)).toBe("真文章標題");
	});
});
