// 经 `node --import` / `tsx --import` 加载:注册 #imports 解析钩子。
import { register } from "node:module";

register("./wxt-imports-loader.mjs", import.meta.url);
