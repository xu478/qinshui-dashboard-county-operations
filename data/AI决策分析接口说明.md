# AI决策分析接口说明 · V0.17

前端已就绪，当前仍使用本地规则建议。连接真实AI需要一个已部署的HTTPS代理服务；模型密钥保存在代理后端。大屏“配置→基础配置→AI决策分析”填写代理网址、勾选启用并保存即可接入。地址、开关、间隔仅保存在当前浏览器。

## 请求与返回

前端对接口发送POST，Content-Type为application/json，body为`{"snapshot": {...}}`，不附带浏览器凭据或模型密钥。代理须允许大屏域名的CORS及OPTIONS预检；本地单文件预览的origin可能为null，正式使用推荐从已发布的网站发起。请求15秒后超时，默认最短间隔30秒、可配置30–300秒，只在经营数据变化时调用，最多一个请求在途。

返回HTTP 200、Content-Type application/json：

```json
{
  "advice": [
    {
      "type": "stock",
      "label": "备货",
      "text": "根据当前订单变化复核门店备货与配送安排。",
      "emphasis": ["备货", "配送"]
    }
  ]
}
```

这是接口结构示例。type只能取stock/data/plan/forecast，对应四种颜色；建议分别用于销售补货、库存冷链、经营渠道、配送履约。1–4条，label不超过12字，text不超过180字。emphasis最多8项，每项不超过40字且须存在于正文中；页面只保留重要金额及已知门店名的加粗，普通动词、比例、吨数和网点数量不加粗。接口返回纯文本，前端不会执行HTML。

## snapshot字段与口径

| 字段 | 含义 |
| --- | --- |
| businessDate / updatedAt | 业务日期 / 本次汇总时间，上海时区 |
| mode / sourceKind / sourceVersion | demo或real / replay、actual-today、historical / 批次标识。模式、日期、导入批次变更时隔离旧结果 |
| displayComposition / baselineSales | baseline-plus-replay或order-net / 演示基数；真实模式基数为0 |
| displayedSales / retail | 主屏展示总额 / 门店展示总额；演示时含日均基数，不能当作纯订单净额 |
| netOrderSales / orderCount | 已累计或所选历史日的全业务订单净额 / 单量；真实今日导入目前仅支持门店 |
| retailOrderSales / retailOrderCount / averageOrder | 同范围门店订单净额 / 张数 / 客单价。客单价=门店净额÷张数，不含日均基数；无订单时null |
| refundCount | 当前完整订单批次中的负额订单数；历史日只有部分流水样本时为null，不能推断为0 |
| recentOrder | 本批最新累计订单的门店名与净额；历史日样本预览时null，避免把样本称为最新真实订单 |
| topOrderStores | 前3个门店的{name, amount, count}，按订单净额降序；历史日用全天门店汇总，门店张数未知时null |
| logistics | active、total、ratio、source；当前为配置值，source=configuration，ratio按active÷total×100，分母为0时null |
| plans | octStores、octLogistics、source；10月为预估配置，source=forecast-configuration |

前端不发送会员编号、客户姓名、电话、完整流水号、SKU明细和原始Excel。不要将配置数字解释为实时配送监测，也不要将回放订单、基数、计划或雷达画像样例解释为真实今日事实。天气已有真实缓存，必须保留来源时间与过期状态；库存批次、可售量、库容、车辆签收及价格预测模型尚未接入，建议不能据此断言已缺货、已临期、已延误或预测已验证。

## 新增匿名上下文

- `salesTrend`：`source`、`currency`，`actual` 为 `{month,amount,periodStart,periodEnd,complete}`，`forecast` 为 `{month,amount,source}`，`baseline` 为 `{coefficient,source}`。真实月额、部分月区间及整月预估保持独立；当前 10 月实绩覆盖 1～5 日，整月预估不能解释为已实现收入。基数系数 0.6 是用户配置，不是研究机构验证的销量模型。
- `logistics.onTimePercent / onTimeSource`：准时率及来源；当前 99.7% 的来源是 `configuration`，只能说配置值待实测。44/70 是配置数量之比，不代表实测履约、车辆利用率或服务覆盖率。
- `reserves`：`ambientTonnes`、`coldTonnes`、`source`；非吨单位传 `null`，不能猜换算。120/50 吨目前为配置储备，不表示实际剩余库容、当前库存或某一批次可售量。
- `consumerMetrics`：`status`、`sourceKind`、`window:{start,end,days,complete}`、`counts:{identifiedCustomers,purchaseOrders,repeatCustomers}`、`replay:{step,total}`。仅读取匿名聚合；原始期间 10 天的会员多次下单占比不能冒充当前 30 日复购率、全部顾客复购率或再次到店概率。`historical-order-replay` 必须说明原始记录回放，不能累计成新的实际购买。
- `weather`：`status`、`provider`、`observedAt`、`currentFetchedAt`、`dailyFetchedAt`、`temperature`，以及最多七项 `{date,high,low,dayPrecipitationMm,windScale}`。缺失数据为 `null`；温度不能当作库内监控温度，白天降水不能当作全天雨量。

新增字段全部进入经营指纹，因此订单不变但计划、储备、月数据或来源状态变化也会重新生成本地建议并按节流规则请求代理。只有页面时钟变化不会轮替或触发模型请求。旧接口字段、模式/批次隔离、无凭证 POST、15 秒超时和失败回退仍保留。

## 本地四类建议

默认 `source=local-rules`，规则版本 `county-supply-chain-rules-v1`；四张卡分别为销售补货、配送履约、库存冷链、经营渠道。各类具有可替换的行动文本，按有效订单数选择，真实订单或配置变化时更新；不随机轮换，不添加随机销售数。卡片标题保留规则依据、分析时间与官方研究来源。

销售建议先核对 SKU 可售量与到货，配送建议核对交付时窗和承诺/签收时间，库存建议补批次、库容和温控交接记录，经营建议区分期间实绩、整月预估、参考基数和会员样本。来源、计算与边界见[县域供应链决策建议研究与规则](县域供应链决策建议研究与规则.md)。

## 代理实施

后端接收并校验汇总→携带后端模型凭据请求模型→要求只依据snapshot生成中文建议→校验上述JSON→返回。缺失字段保留null，不补造事实；关键金额、数量、名称放入emphasis，普通文字不加粗。没有足够数据时可建议复核或补数。

公开大屏采用无浏览器凭据调用时，代理需设置访问来源、请求频率与模型费用限额。部署后的接口应可从其他电脑访问；本机localhost接口只用于本机开发。不要把模型密钥写进前端地址、代码或公开仓库。

失败、超时、非JSON或字段无效时，页面回退最新本地规则建议并在配置页显示状态。同源慢响应可显示，其分析时间保留于配置页；后续按变化刷新。业务日期/模式/批次变更会丢弃旧响应。本地规则高亮由真实数据变化触发，不随机修改指标。

## 尚需提供

一个HTTPS代理网址及接口说明；如果尚无代理，需要先确定模型服务与部署环境，再实施后端。当前没有实际调用任何模型服务，模拟接口仅用于验证前端处理与异常回退。
