# 独立站点部署说明

## 站点边界

| 站点 | 域名 | 服务 | 数据 |
| --- | --- | --- | --- |
| 个人网站 | `greenwoods.skin` | `jinyu-portfolio` 静态容器 | Git 管理的静态文件 |
| 阅读网站 | `reading.greenwoods.skin` | `greenforest-reading` 独立容器 | 阅读站自己的数据目录 |

两个网站不共享代码、容器或数据文件。个人网站只通过外部链接进入阅读网站。

## 个人网站发布

个人站发布目录为：

```text
portfolio/
├─ index.html
├─ about.html
├─ projects.html
├─ notes.html
└─ assets/site.css
```

将 `portfolio/` 的**内容**同步到服务器的 `/opt/greenwoods.skin/site/`。`jinyu-portfolio` 容器以只读方式挂载该目录，Caddy 已负责 `greenwoods.skin` 的 HTTPS 与反向代理。

## 阅读网站接入

在 Cloudflare DNS 中添加一条代理开启的记录：

```text
类型：A
名称：read
内容：服务器公网 IP
代理：开启（橙色云朵）
```

然后在现有 Caddyfile 中增加独立站点块：

```caddy
reading.greenwoods.skin {
    encode zstd gzip
    reverse_proxy greenforest-reading:3000
}
```

修改后先验证配置，再热加载 Caddy。不要新开公网端口，也不要改变 `greenwoods.skin` 的现有站点块。

## 发布检查

1. 个人站四个页面均返回 HTTP 200。
2. `reading.greenwoods.skin` 的 DNS 已指向服务器后，再验证 HTTPS 证书。
3. 检查个人站的“阅读空间”链接可跳转。
4. 阅读站数据目录与 Caddyfile 都应纳入服务器备份。
