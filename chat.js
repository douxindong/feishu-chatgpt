// 引入基础依赖包
const aircode = require('aircode');
const axios = require('axios');

// 引入 OpenAI 的 SDK
const openai = require("openai");

// 从环境变量中获取 OpenAI 的 Secret
const OpenAISecret = process.env.OpenAISecret;

// 更新飞书卡片消息频率 单位（毫秒ms）
const frequency = 800;

//是否启用是流式输出
const enable_stream = true;

let chatGPT = null;

if (OpenAISecret) {
  // 与 ChatGTP 聊天的方法，传入字符串即可
  const configuration = new openai.Configuration({ apiKey: OpenAISecret });
  const client = new openai.OpenAIApi(configuration);
  if(enable_stream){
    //https://github.com/openai/openai-node/issues/18#issuecomment-1369996933
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
  }else{
    chatGPT = async (content) => {
      return await client.createChatCompletion({
        // 使用当前 OpenAI 开放的最新 3.5 模型，如果后续 4 发布，则修改此处参数即可
        model: 'gpt-3.5-turbo',
        // 让 ChatGPT 充当的角色为 assistant
        messages: [{ role: 'assistant', content }],
      });
    };
  }
}

// 从环境变量中获取飞书机器人的 App ID 和 App Secret
const feishuAppId = process.env.feishuAppId;
const feishuAppSecret = process.env.feishuAppSecret;

// 获取飞书 tenant_access_token 的方法
const getTenantToken = async () => {
  const url = 'https://open.feishu.cn/open-apis/v3/auth/tenant_access_token/internal/';
  const res = await axios.post(url, { 
    'app_id': feishuAppId, 'app_secret': feishuAppSecret,
  });
  return res.data.tenant_access_token;
};

// 用飞书机器人回复用户消息的方法
const feishuReply = async (objs) => {
  const tenantToken = await getTenantToken();
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${objs.msgId}/reply`;
  let content = objs.content;
  
  // 实现 at 用户能力
  if (objs.openId) content = `<at user_id="${objs.openId}"></at> ${content}`;
  const res = await axios({ 
    url, method: 'post',
    headers: { 'Authorization': `Bearer ${tenantToken}` },
    data: { msg_type: 'text', content: JSON.stringify({ text: content }) }
  });
  return res.data.data;
};

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

// 飞书 ChatGPT 机器人的入口函数
module.exports = async function(params, context) {

  // 判断是否开启了事件 Encrypt Key，如果开启提示错误
  if (params.encrypt) return { error: '请在飞书机器人配置中移除 Encrypt Key。' }

  // 用来做飞书接口校验，飞书接口要求有 challenge 参数时需直接返回
  if (params.challenge) return { challenge: params.challenge };  
  
  // 判断是否没有开启事件相关权限，如果没有开启，则返回错误
  if (!params.header || !params.header.event_id) {
    // 判断当前是否为通过 Debug 环境触发
    if (context.trigger === 'DEBUG') {
      return { error: '如机器人已配置好，请先通过与机器人聊天测试，再使用「Mock by online requests」功能调试。', };
    } else {
      return { error: '请参考教程配置好飞书机器人的事件权限，相关权限需发布机器人后才能生效。', };
    }
  }

  // 所有调用当前函数的参数都可以直接从 params 中获取
  // 飞书机器人每条用户消息都会有 event_id
  const eventId = params.header.event_id;

  // 可以使用数据库极其简单地写入数据到数据表中
  // 实例化一个名字叫做 contents 的表
  const contentsTable = aircode.db.table('contents');
  
  // 搜索 contents 表中是否有 eventId 与当前这次一致的
  const contentObj = await contentsTable.where({ eventId }).findOne();
  
  // 如果 contentObj 有值，则代表这条 event 出现过
  // 由于 ChatGPT 返回时间较长，这种情况可能是飞书的重试，直接 return 掉，防止重复调用
  if (contentObj) return;
  const message = params.event.message;
  const msgType = message.message_type;

  // 获取发送消息的人信息
  const sender = params.event.sender;

  // 用户发送过来的内容
  let content = '';

  // 返回给用户的消息
  let replyContent = '';

  // 需要更新的消息的message_id
  let replyMsgId = null;

  //ChatGPT请求结果
  let result = null;

  

  // 目前 ChatGPT 仅支持文本内容
  if (msgType === 'text') {

    // 获取用户具体消息，机器人默认将收到的消息直接返回
    content = JSON.parse(message.content).text.replace('@_user_1 ', '');

    // 默认将用户发送的内容回复给用户，仅是一个直接返回对话的机器人
    replyContent = content;    

    // 将消息体信息储存到数据库中，以备后续查询历史或做上下文支持使用
    await contentsTable.save({ 
      eventId,    
      msgId: message.message_id, 
      openId: sender.sender_id.open_id,
      content,
    });
    
    // 如果配置了 OpenAI Key 则让 ChatGPT 回复
    if (OpenAISecret) {
      
      // 将用户具体消息发送给 ChatGPT
      result = await chatGPT(content);
      
      // 将获取到的 ChatGPT 回复给用户
      if(!enable_stream){
        replyContent = `${result.data.choices[0].message.content.trim()}`;   
      }
    }
  } else {
    replyContent = '不好意思，暂时不支持其他类型的文件。';
  }
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
  // 整个函数调用结束，需要有返回
  return null;
}


