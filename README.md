# HGhub-Plugin

HGhub 插件集（HPP 1.0，单文件数据源）。

| 插件 | 能力 | 备注 |
| --- | --- | --- |
| `bfzy.source` 暴风资源 | 首页 / 分类 / 搜索 / 详情 / 播放 | |
| `tangxin.vlog` 糖心Vlog | 首页 / 演员·标签 / 搜索 / 详情 / 播放 | 成人内容，需在设置里开启 |
| `av321.source` 321AV | 首页 / 分类 / 搜索 / 详情 / 播放 | 成人内容，需在设置里开启 |
| `hanime16.source` H動漫 hanime16 | 首页 / 分类 / 搜索 / 详情 / 播放 | 成人内容，需在设置里开启 |
| `ck69.source` 黄色仓库 | 首页 / 分类 / 搜索 / 详情 / 播放 | 成人内容，需在设置里开启 |

```
manifest/manifest.json      插件列表，订阅入口
plugins/bfzy.source.js      单文件插件
plugins/tangxin.vlog.js     单文件插件
plugins/av321.source.js     单文件插件
plugins/hanime16.source.js  单文件插件
plugins/ck69.source.js      单文件插件
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

## 说明

- 不需要账号，不读写片库以外的数据，插件只在被调用时运行。
- `tangxin.vlog`、`av321.source`、`hanime16.source` 与 `ck69.source` 声明了 `meta.mature`，宿主默认隐藏，需在设置里允许成人内容后才会出现。
- 数据与播放地址来自上游采集接口，站点换域名或改接口会导致插件失效；换地址时改 `plugins/bfzy.source.js` 顶部的 `API` 常量。
- 流地址有时效，播放中途失效时宿主会带 `reason: "refresh"` 重新调用插件解析。
