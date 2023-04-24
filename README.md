# feishu-chatgpt
飞书机器人-ChatGPT

本项目为 [用 JavaScript 开发飞书 ChatGPT 机器人（含全部源码，免费托管，手把手教程）](https://aircode.cool/q4y1msdim4) 基础上进行扩展支持stream输出的修改版本。

### 修改步骤：

```javascrpt
// 更新飞书卡片消息频率 单位（毫秒ms）
const frequency = 800;

//是否启用是流式输出
const enable_stream = true;

```

#### 请求方法更改：

参考：
https://github.com/openai/openai-node/issues/18#issuecomment-1369996933
https://platform.openai.com/docs/api-reference/chat/create

```javascrpt

chatGPT = async (content) => {
      console.log(content);
      return await client.createChatCompletion({
            model: "gpt-3.5-turbo",
            // prompt: content,
            messages: [{ role: 'assistant', content: content }],
            max_tokens: 1000,
            temperature: 0,
            stream: true,
        }, { responseType: 'stream' });
    };
```

#### 新增回复卡片消息和更新卡片消息方法及卡片构造方法

```javascrpt
// 用飞书机器人回复用户card消息的方法
const feishuCardReply = async (objs) => {
  const tenantToken = await getTenantToken();
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${objs.msgId}/reply`;
  let content = objs.content;
  const res = await axios({ 
    url, method: 'post',
    headers: { 'Authorization': `Bearer ${tenantToken}` },
    data: { msg_type: 'interactive', content: getCardContent(content,objs) }
  });
  return res.data.data;
};

// 用飞书机器人回复用户消息的方法 - 更新卡片消息
const feishuUpdateCardReply = async (objs) => {
  const tenantToken = await getTenantToken();
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${objs.msgId}`;
  let content = objs.content;
  const res = await axios({ 
    url, method: 'patch',
    headers: { 'Authorization': `Bearer ${tenantToken}` },
    data: { msg_type: 'interactive', content: getCardContent(content,objs) },
  });
  return res.data.data;
};

// 构造飞书card消息内容
const getCardContent = (content,objs) => {
  if (objs.openId) atstr = `<at id="${objs.openId}"></at> `;
  let data = {elements:[{tag: "div",text: {tag: "lark_md",content: atstr}},{tag: "div",text: {tag: "plain_text",content}}]};
  let json = JSON.stringify(data);console.log(json);
  return json;
}
```

#### stream 解析
https://github.com/openai/openai-node/issues/18#issuecomment-1372047643
https://2ality.com/2018/04/async-iter-nodejs.html#processing-async-iterables-via-async-generators

```javascrpt
async function* chunksToLines(chunksAsync) {
  let previous = "";
  for await (const chunk of chunksAsync) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    previous += bufferChunk;
    let eolIndex;
    while ((eolIndex = previous.indexOf("\n")) >= 0) {
      // line includes the EOL
      const line = previous.slice(0, eolIndex + 1).trimEnd();
      if (line === "data: [DONE]") break;
      if (line.startsWith("data: ")) yield line;
      previous = previous.slice(eolIndex + 1);
    }
  }
}

async function* linesToMessages(linesAsync) {
  for await (const line of linesAsync) {
    const message = line.substring("data :".length);
    yield message;
  }
}

async function* streamCompletion(data) {
  yield* linesToMessages(chunksToLines(data));
}
```

#### 回复卡片消息和更新卡片消息

```javascrpt
if(enable_stream){
    replyContent = '思考中...';
    if(replyMsgId == null){
      // 将处理后的消息通过飞书机器人发送给用户
      const res = await feishuCardReply({
        msgId: message.message_id, 
        openId: sender.sender_id.open_id,
        content: replyContent,
      });
      replyMsgId = res.message_id;
      const dbObj = await contentsTable.where({ eventId }).findOne();
      dbObj.replyMsgId = replyMsgId;//存储消息卡片的message_id 用于更新卡片消息
      await contentsTable.save(dbObj);//https://docs-cn.aircode.io/getting-started/database
    }
    replyContent = '';
    let t = new Date().getTime();
    for await (const message of streamCompletion(result.data)) {
        try {
          const parsed = JSON.parse(message);
          let obj = parsed.choices[0];
          // console.log( obj,'-',obj.delta.content);
          if(obj.finish_reason == 'stop'){
            console.log('结束');
            await feishuUpdateCardReply({
              msgId: replyMsgId,
              openId: sender.sender_id.open_id,
              content: replyContent,
            });
          }else{
            let character = obj.delta.content;
            if(character != undefined){
              replyContent += character;
            }
            let curr = new Date().getTime();
            if( curr - t > frequency){
              t = curr;
              if(replyMsgId != null){
                await feishuUpdateCardReply({
                  msgId: replyMsgId,
                  openId: sender.sender_id.open_id,
                  content: replyContent,
                });
              }
            }
          }
        } catch (error) {
          console.error("Could not JSON parse stream message", message, error);
        }
    }
  }else{
    await feishuReply({
      msgId: message.message_id, 
      openId: sender.sender_id.open_id,
      content: replyContent,
    });
  }
```

[详细完整的见chat.js](./chat.js)


![](./resource/feishu_1.gif)
[点击观看录屏](https://baxanr9pasf.feishu.cn/docx/GPprdU62Jox7UExkppfcKXAGnzd)
