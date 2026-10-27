# 公网部署指南

鉴权已内置于后端:`.env` 配置密码即启用,不配置则维持本机免密模式。

```ini
# .env
WB_ADMIN_PASSWORD=你的管理密码      # 必填才有鉴权;为空 = 本机免密模式
WB_SHARE_PASSWORD=只听分享密码      # 可选:凭此密码登录只能浏览/播放,不能触发任务
WB_AUTH_SECRET=一串随机字符         # 可选:Cookie 签名密钥,不设则从管理密码派生
```

角色:
- **admin**:全部功能(生成/挖补/删除/模型管理);
- **listen**:只能 GET(浏览、播放、下载),所有写操作返回 403,系统页隐藏。

登录限频:每 IP 60 秒内最多 8 次尝试。

## 路线 A:Tailscale(只给自己用,推荐先做)

零代码、零端口暴露:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # 浏览器打开授权链接登录
tailscale ip -4              # 得到 100.x.x.x
```

手机装 Tailscale 登录同一账号,浏览器访问 `http://100.x.x.x:8000` 即可。流量走加密隧道,公网不可见。

## 路线 B:Cloudflare Tunnel + 域名(可分享给朋友)

1. 有一个托管在 Cloudflare 的域名;
2. 服务器安装 cloudflared 并登录:

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login
cloudflared tunnel create workbench
cloudflared tunnel route dns workbench music.你的域名.com
```

3. 配置 `~/.cloudflared/config.yml`:

```yaml
tunnel: workbench
credentials-file: /home/feifei/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: music.你的域名.com
    service: http://localhost:8000
  - service: http_status:404
```

4. 常驻:

```bash
sudo cloudflared service install
```

5. `.env` 里配好 `WB_ADMIN_PASSWORD` + `WB_SHARE_PASSWORD`,重启后端,把
   `http://music.你的域名.com`(CF 自动 HTTPS)发给朋友,他们用只听密码进入。

注意:通过 HTTPS 访问时才是安全上下文,浏览器通知等功能可用;国内到 CF 边缘的速度需自行实测。

## systemd 常驻(替代 ./server.sh start)

`deploy/workbench.service` 已提供:

```bash
sudo cp deploy/workbench.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now workbench
journalctl -u workbench -f
```

## 安全清单(公网前自查)

- [ ] `WB_ADMIN_PASSWORD` 已设置(否则整个站点免密裸奔)
- [ ] 只听密码与密码不同
- [ ] 任务端点只对 admin 开放(listen 角色写操作 403,后端中间件强制)
- [ ] 队列上限(默认 10)已生效,陌生流量打不满 GPU
- [ ] 不要把 8000 端口直接映射到公网;走隧道
