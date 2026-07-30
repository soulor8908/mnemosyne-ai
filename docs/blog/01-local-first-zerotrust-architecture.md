# Local-First + 零信任多用户登录的云笔记架构

> 这是我做 [Mnemosyne](https://github.com/soulor8908/mnemosyne-ai)（AI 时代的云笔记）时最纠结的一块：**既要本地优先保证数据主权，又要能多设备多用户同步，还绝不能让服务端看到用户明文**。
>
> 这篇文章讲清楚我最终怎么做的——不是概念搬运，是每一行代码都在仓库里的真实实现，包括我踩过的一个"用 header 透传主密钥"的严重安全设计错误。

## 一、为什么 Local-First 是反主流的选择

主流云笔记（Notion / 印象笔记 / 飞书文档）都是 SaaS 架构：数据在服务端，客户端只是视图。这个模型有三个问题我无法接受：

1. **离线不可用**——地铁里打开 Notion 看不到昨天写的笔记
2. **数据主权不属于用户**——服务端随时能看你的内容，服务商倒闭就全没了
3. **AI 无法本地化**——想把 AI 嵌入笔记流程，得把内容发给服务端再发给 LLM，链路太长

Local-First 反过来：**本地是真理之源，服务端只是加密备份**。代价是同步和登录都更难做——这正是本文要讲的。

我用的技术栈：

| 层 | 选型 | 为什么 |
|---|---|---|
| 本地存储 | Dexie（IndexedDB 封装） | 浏览器原生，事务/索引齐全，离线可用 |
| 远程备份 | Cloudflare KV | 边缘节点快、按量计费、有 TTL |
| 加密 | Web Crypto API（AES-GCM 256 + PBKDF2） | 浏览器/Workers 通用，无需第三方库 |
| 助记词 | BIP39（12 词，128-bit 熵） | 人类可抄写，跨设备恢复 |
| 登录协议 | SCRAM-lite（挑战应答） | 服务端零知识，见下文 |

## 二、零信任的核心矛盾

零信任的要求很直接：**主密钥（MASTER_KEY）永远不出客户端**。但登录又得让服务端"相信你确实掌握主密钥"。

朴素方案是用户名+密码——但密码会到服务端，违反零信任。
第二种是端到端加密+服务端只存密文——但登录时怎么验证身份？

我的方案是 **SCRAM-lite**（SASL SCRAM 的简化版），核心思想：**服务端存一个验证器 verifier = H(masterKey)，登录时通过挑战应答证明客户端掌握 masterKey，而 masterKey 永不上传**。

## 三、密钥派生：从 12 词助记词到 256-bit 主密钥

用户记住的是 12 个英文单词（BIP39），不是一串密钥。这 12 词派生出 256-bit 的 MASTER_KEY，MASTER_KEY 再派生出 userId 和 verifier。

### 3.1 生成助记词

```typescript
// src/lib/crypto/index.ts
const BIP39_STRENGTH_BYTES = 16; // 128 bit → 12 词

export async function generateMnemonicAsync(): Promise<string> {
  const entropy = new Uint8Array(BIP39_STRENGTH_BYTES);
  globalThis.crypto.getRandomValues(entropy);

  // BIP39 规范：entropy + SHA-256 校验位首字节
  const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', entropy);
  const combined = new Uint8Array(entropy.length + 1);
  combined.set(entropy, 0);
  combined[entropy.length] = new Uint8Array(hashBuf)[0];

  // 每 11 位映射一个词（2^11 = 2048 词表）
  const words: string[] = [];
  for (let i = 0; i < 132; i += 11) {
    let idx = 0;
    for (let j = 0; j < 11; j++) {
      const bitPos = i + j;
      const bytePos = Math.floor(bitPos / 8);
      const bitInByte = 7 - (bitPos % 8);
      const bit = (combined[bytePos] >> bitInByte) & 1;
      idx = (idx << 1) | bit;
    }
    words.push(BIP39_WORDLIST[idx & 0x7ff]);
  }
  return words.slice(0, 12).join(' ');
}
```

### 3.2 助记词 → 主密钥

用 PBKDF2（10 万次迭代）把助记词拉伸成 256-bit AES-GCM 密钥。**固定 salt 是有意的**——这保证了同一组助记词在任何设备上都派生出同一个 masterKey，从而实现跨设备恢复。

```typescript
export async function masterKeyFromMnemonic(mnemonic: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(mnemonic.normalize('NFKD')),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const derived = await subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('mnemosyne-master-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await subtle.exportKey('raw', derived);
  return bytesToBase64(new Uint8Array(raw));
}
```

### 3.3 一个我踩过的坑：助记词校验

早期版本我只校验"12 个词 + 都在词表里"。结果用户把 12 个合法词**顺序打乱**也能通过校验，直到派生 masterKey 时才报"密钥不匹配"——用户会以为是密钥错了，实际是词序错了。

修复方法是补上 BIP39 checksum 校验：12 词 = 132 bit = 128 bit 熵 + 4 bit 校验，校验位是 entropy 的 SHA-256 高 4 位。顺序一错，checksum 立刻对不上。

```typescript
// 取 combined 第 16 字节的高 4 位作为助记词携带的 checksum
const storedChecksum = (combined[16] >> 4) & 0xf;
const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', entropy);
const computedChecksum = (new Uint8Array(hashBuf)[0] >> 4) & 0xf;

if (storedChecksum !== computedChecksum) {
  return { ok: false, words, error: '助记词校验失败：单词或顺序有误' };
}
```

**教训**：错误信息要指向真正的失败原因，而不是让用户在下游摸不着头脑。

## 四、SCRAM-lite：服务端零知识的登录协议

### 4.1 三个派生量

从 masterKey 派生出三个量，各司其职：

```typescript
// src/lib/auth/client-auth.ts
userId   = H("uid|" + masterKey)   // 账户标识，高熵，服务端用它查 verifier
verifier = H("vrf|" + masterKey)   // 验证器，服务端存储，无法反推 masterKey
response = H(verifier + "|" + challenge)  // 证明掌握 masterKey
```

- `userId` 是高熵的（256-bit 派生），所以**自动注册是安全的**——攻击者无法抢注特定用户的账号，只能抢注随机 userId（对其毫无意义）
- `verifier` 存在服务端，但 H 是单向的，拿到 verifier 也反推不出 masterKey
- `response` 是一次性应答，绑定 challenge，无法重放

### 4.2 三步握手

完整登录流程分三步：

**第一步：客户端发起（POST /api/auth/start）**

客户端发 `userId + verifier`。服务端首次见到该 userId 就自动注册（存 verifier），已存在则忽略 verifier。

```typescript
// src/lib/auth/zerotrust.ts
export async function registerOrGetUser(userId: string, verifier: string): Promise<void> {
  const env = getEnv();
  const existing = await env.AUTH_USERS.get(`user:${userId}`);
  if (!existing) {
    await env.AUTH_USERS.put(
      `user:${userId}`,
      JSON.stringify({ verifier, createdAt: Date.now() })
    );
  }
}
```

然后签发一个 120 秒 TTL 的一次性 challenge：

```typescript
const CHALLENGE_TTL = 120; // 秒，防截获重放

export async function issueChallenge(userId: string): Promise<string> {
  const challenge = nanoid(32);
  await env.AUTH_NONCES.put(`challenge:${userId}`, challenge, {
    expirationTtl: CHALLENGE_TTL,
  });
  return challenge;
}
```

**第二步：客户端应答（POST /api/auth/verify）**

客户端算 `response = H(verifier + "|" + challenge)`，连同 challenge 一起回传。服务端用自己存的 verifier 复算并比对：

```typescript
export async function verifyLogin(
  userId: string,
  challenge: string,
  clientResponse: string
): Promise<string | null> {
  const raw = await env.AUTH_USERS.get(`user:${userId}`);
  if (!raw) return null;
  const { verifier } = JSON.parse(raw);

  const expected = await sha256(`${verifier}|${challenge}`);
  if (expected !== clientResponse) return null;

  return createSession(userId); // 签发会话令牌
}
```

**为什么这是零知识？** 整个流程服务端只见过 `userId / verifier / response`，这三个都是哈希，**masterKey 从未离开客户端**。即使服务端被拖库，攻击者拿到所有 verifier 也无法反推任何用户的 masterKey。

### 4.3 challenge 必须一次性消费

`/api/auth/verify` 里有个细节：challenge 是取出即删的，不能复用。

```typescript
export async function consumeChallenge(userId: string): Promise<string | null> {
  const challenge = await env.AUTH_NONCES.get(`challenge:${userId}`);
  if (challenge) await env.AUTH_NONCES.delete(`challenge:${userId}`);
  return challenge;
}
```

**为什么不复用？** 如果 challenge 可以多次用，攻击者截获一次 response 就能反复登录。一次性消费 + 120 秒 TTL 双保险。

### 4.4 会话令牌：7 天有效，KV 存储

登录成功后签发 sessionId（nanoid 32 字符），存 KV，7 天 TTL：

```typescript
export async function createSession(userId: string): Promise<string> {
  const sessionId = nanoid(32);
  await env.AUTH_SESSIONS.put(
    `sess:${sessionId}`,
    JSON.stringify({ userId, createdAt: Date.now() }),
    { expirationTtl: 7 * 24 * 3600 }
  );
  return sessionId;
}
```

客户端拿到 sessionId 后，后续所有 `/api/*` 请求用 `Authorization: Bearer <sessionId>` 携带。

## 五、API 鉴权守卫：双令牌 + 时序安全

### 5.1 兼容遗留令牌

我有一段历史代码用的是单一共享 `SYNC_TOKEN`（单用户管理态）。重构多用户登录时不能直接砍掉，否则旧客户端全挂。所以守卫接受两类凭据：

```typescript
// src/lib/auth/guard.ts
export async function resolveAuth(req: Request): Promise<AuthResult> {
  const header = req.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  // 1) 遗留共享令牌（单用户/管理态）
  if (env.SYNC_TOKEN) {
    const [a, b] = await Promise.all([sha256(provided), sha256(env.SYNC_TOKEN)]);
    if (a === b) return { userId: 'local', legacy: true, err: null };
  }

  // 2) 零信任会话令牌（多用户）
  if (provided.length >= 16) {
    const raw = await env.AUTH_SESSIONS.get(`sess:${provided}`);
    if (raw) {
      const data = JSON.parse(raw);
      return { userId: data.userId, legacy: false, err: null };
    }
  }

  return { userId: null, legacy: false, err: unauthorized('访问令牌不正确') };
}
```

### 5.2 时序安全比较

注意遗留令牌那行：**先各自 sha256 再比较**，不是直接字符串比较。

```typescript
const [a, b] = await Promise.all([sha256(provided), sha256(env.SYNC_TOKEN)]);
if (a === b) return { userId: 'local', legacy: true, err: null };
```

**为什么？** 朴素字符串比较是短路求值的——第一个不匹配的字符就返回，比较耗时与匹配前缀长度正相关。攻击者可以通过测量响应时间逐字节猜出令牌（时序侧信道）。先哈希再比，比较时间恒定，侧信道被堵死。

### 5.3 Fail-Closed 原则

守卫的注释里写了一条原则：**未配置任何令牌 → 503，宁可服务不可用，不可裸奔**。

```typescript
// 缺失令牌 → 401
if (!provided) {
  return { userId: null, legacy: false, err: unauthorized('缺少访问令牌') };
}
```

这是安全设计的默认姿态：**没配置就拒绝**，而不是"没配置就放行"。后者出过无数安全事故。

## 六、我踩过的最大一个坑：用 Header 透传主密钥

这是本文最值得讲的部分——**我曾犯过一个严重的安全设计错误**。

### 6.1 错误的设计

最早我定义了一个 `x-mnemosyne-key` HTTP header，客户端用它把 MASTER_KEY "透传"给服务端做加解密。当时想的是"反正 HTTPS 加密了传输层"。

这个设计**直接违反了"主密钥永不离开客户端"的端到端加密承诺**。HTTPS 只保护传输层，但：

1. 服务端日志可能记录 header（很多中间件默认记）
2. 服务端内存里有明文 masterKey，被拖库就全暴露
3. 违反了零信任的根本前提——一旦 masterKey 到过服务端，"零信任"就是谎言

### 6.2 修复

彻底删除该通道，服务端鉴权改用 Bearer 令牌。代码注释里我留了这段反思：

```typescript
// src/lib/auth/session.ts
// 安全修复说明：曾定义 x-mnemosyne-key header 用于客户端向服务端"透传"MASTER_KEY，
// 这与"主密钥永不离开客户端"的端到端加密承诺直接冲突，且从未被调用。
// 已彻底删除该通道；服务端鉴权改用 SYNC_TOKEN Bearer 令牌（见 guard.ts）。
```

**教训**：零信任是架构原则，不是"加了 HTTPS 就行"。任何让密钥经过服务端的设计，无论多么"方便"，都是在挖坑。**如果某个安全承诺有例外，那它就不是承诺。**

## 七、加密同步：字段级合并 + 冲突快照

登录解决了"你是谁"，同步要解决"多设备怎么合"。我的方案是 **时间戳 + 字段级合并 + 乐观锁 + 冲突快照**。

### 7.1 上行：加密后写 KV

本地笔记上传前，**内容和元数据分别加密**：

```typescript
// src/lib/sync/engine.ts
export async function syncNoteUp(note: Note, env: Env, userId: string): Promise<void> {
  const key = await getCryptoKey(); // 本地取 masterKey
  if (!key) throw new Error('MASTER_KEY 未初始化');

  const contentCipher = await encryptJSON({ content: note.content }, key);
  const metaCipher = await encryptJSON({
    title: note.title, tags: note.tags, folderId: note.folderId,
    status: note.status, frontmatter: note.frontmatter,
    // ... 其余元数据
  }, key);

  const delta: SyncDelta = {
    noteId: note.id, rev: note.rev,
    contentCipher, meta: metaCipher,
    updatedAt: note.updatedAt,
  };

  // KV 里只有密文
  await env.NOTES_DELTA.put(
    `u:${userId}:delta:${note.id}:${note.rev}`,
    JSON.stringify(delta),
    { expirationTtl: 30 * 24 * 3600 }
  );
}
```

服务端看到的 `delta.meta` 是一串 base64 密文，**服务端永远不知道这条笔记的标题是什么**。

### 7.2 下行：三种情况

拉取远程 delta 时，按本地是否已有 + rev 比较分三种情况：

```typescript
if (!local) {
  // 本地无 → 直接拉取解密写入
} else if (local.rev < rev) {
  // 本地旧 → 合并，但有 pending 编辑时先存快照
  if (local.syncStatus === 'pending') {
    await db.snapshots.add({
      id: `${noteId}:${local.rev}:${Date.now()}`,
      noteId, content: local.content,
      reason: 'pre-sync-conflict',
    });
    conflicts++;
  }
  // 字段级合并
  const merged = {
    ...local,
    title: meta.title ?? local.title,
    tags: [...new Set([...local.tags, ...meta.tags])], // tags 并集
    frontmatter: { ...local.frontmatter, ...meta.frontmatter }, // 浅合并
    syncStatus: local.syncStatus === 'pending' ? 'conflict' : 'synced',
  };
} else if (local.rev > rev) {
  // 本地新 → 保留本地，下次上行会覆盖远程
  continue;
}
```

### 7.3 字段级合并的取舍

- `tags`：取**并集**——两边加的标签都保留，不丢
- `frontmatter`：**浅合并**，远程字段优先（updatedAt 更新者）
- `content`：按 `updatedAt` 取最新——内容级别的合并太复杂（CRDT），单用户场景不值得

这是工程取舍：**单用户笔记不需要全量 CRDT，字段级合并 + 冲突快照够用**。真有冲突时，本地编辑被快照保存并标记 `syncStatus = 'conflict'`，UI 提示用户去快照里找回。

## 八、审计日志：让登录可追溯

每次登录我都会写一条审计日志，90 天 TTL：

```typescript
export async function audit(userId: string, event: string, meta?: Record<string, unknown>): Promise<void> {
  await env.AUTH_AUDIT.put(
    `audit:${userId}:${ts}:${nanoid(6)}`,
    JSON.stringify({ event, meta, ts }),
    { expirationTtl: 90 * 24 * 3600 }
  );
}
```

这不是为了防外敌，是为了**让自己能复盘**——"上周三那台设备登录过吗""我什么时候初始化的保险库"。零信任系统里，用户对自己的数据要有完全的可观测性。

## 九、架构全景图

```
┌─────────────────────────────────────────────────────────────┐
│                       客户端（浏览器）                         │
│                                                             │
│  助记词（12 词，用户记忆）                                      │
│       │ PBKDF2 100k iterations                              │
│       ▼                                                     │
│  MASTER_KEY（256-bit，永不离开客户端）                         │
│       │                                                     │
│       ├──► AES-GCM 加密笔记内容 ──► 本地 Dexie/IndexedDB     │
│       │                                                     │
│       ├──► userId  = H("uid|" + masterKey)                  │
│       ├──► verifier = H("vrf|" + masterKey)                 │
│       └──► response = H(verifier + "|" + challenge)         │
│                                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS（只传 userId/verifier/response/密文）
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cloudflare Workers + KV（服务端）            │
│                                                             │
│  AUTH_USERS    : userId → { verifier, createdAt }           │
│  AUTH_NONCES   : challenge（120s TTL，一次性）                │
│  AUTH_SESSIONS : sessionId → { userId }（7 天 TTL）          │
│  AUTH_AUDIT    : 审计日志（90 天 TTL）                        │
│  NOTES_DELTA   : 加密 delta（30 天 TTL）                     │
│                                                             │
│  ⚠️ 服务端从未持有 masterKey，无法解密任何笔记内容             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 十、总结与反思

### 做对的事

1. **SCRAM-lite 让零信任登录成为可能**——服务端只存 verifier，拖库不泄密
2. **challenge 一次性消费 + TTL**——防重放攻击
3. **sha256 后再比较令牌**——堵时序侧信道
4. **Fail-closed**——没配置令牌就 503，不裸奔
5. **字段级合并 + 冲突快照**——单用户够用，不上 CRDT 的复杂度
6. **审计日志**——用户对自己数据有可观测性

### 做错过的事

1. **用 header 透传 masterKey**——违反零信任的根本承诺，已删除
2. **助记词只校验词数不校验 checksum**——错误信息误导用户，已补 checksum

### 如果重做会改的

1. **verifier 加盐**——现在 verifier = H(masterKey) 是确定性的，同 masterKey 永远同 verifier。加盐（per-user salt）能让相同 masterKey 在不同实例有不同 verifier，进一步防彩虹表。当时没做是因为 userId 本身高熵，攻击者构造彩虹表成本极高。
2. **会话令牌签发用 HMAC 而非随机串**——现在 sessionId 是随机 nanoid 存 KV 查表，每次请求都要查一次 KV。改成 HMAC(masterKey, timestamp) 无状态令牌可以省一次 KV 查询，代价是撤销不即时。工程取舍。

### 一句话

**零信任不是"用了加密"，而是"服务端能被完全拖库，用户数据依然安全"**。这套架构做到了——服务端只有 verifier 和密文，masterKey 从未离开客户端。

---

**项目地址**：[github.com/soulor8908/mnemosyne-ai](https://github.com/soulor8908/mnemosyne-ai)
**相关代码**：
- [src/lib/auth/zerotrust.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/auth/zerotrust.ts) — SCRAM-lite 核心逻辑
- [src/lib/auth/guard.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/auth/guard.ts) — 双令牌鉴权守卫
- [src/lib/auth/session.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/auth/session.ts) — session 管理 + 安全修复注释
- [src/lib/crypto/index.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/crypto/index.ts) — BIP39 + AES-GCM
- [src/lib/sync/engine.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/sync/engine.ts) — 加密同步引擎

**下一篇预告**：《从 0 到 1 写一个标准 MCP Server：让 Claude 读你的知识库》
