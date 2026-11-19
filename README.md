# HGhub-Plugin

HGhub 插件集（HPP 1.0，单文件数据源）。

| 插件 | 能力 |
| --- | --- |
| `bfzy.source` 暴风资源 | 首页 / 分类 / 搜索 / 详情 / 播放 |

```
manifest/manifest.json      插件列表，订阅入口
plugins/bfzy.source.js      单文件插件
```

## 订阅

在 HGhub 里导入下面这个地址即可，它是一份插件列表：

```
https://raw.githubusercontent.com/poisonhs/HGhub-Plugin/main/manifest/manifest.json
```

1. 打开 HGhub，进入 **插件中心 → 导入与订阅**（手机端从「我的」进插件中心）。
2. 选择「网址 / 订阅」，粘贴上面的地址，确认。
3. 列表里出现 **暴风资源 v1.0.0**，勾选导入；状态变成「已就绪」后返回首页。

回到搜索框输入「大理寺」，能出结果、能点进详情选集、能播放，就通了。

导入后这个地址会存成一条订阅，以后在订阅页点「检查更新」即可拉取新版本，不用重新粘贴。

## 单文件导入

只想装这一个插件，可以直接粘插件文件的地址：

```
https://raw.githubusercontent.com/poisonhs/HGhub-Plugin/main/plugins/bfzy.source.js
```

或把文件内容整段贴进导入框，效果相同。

## 说明

- 不需要账号，不读写片库以外的数据，插件只在被调用时运行。
- 数据与播放地址来自上游采集接口，站点换域名或改接口会导致插件失效；换地址时改 `plugins/bfzy.source.js` 顶部的 `API` 常量。
- 流地址有时效，播放中途失效时宿主会带 `reason: "refresh"` 重新调用插件解析。
