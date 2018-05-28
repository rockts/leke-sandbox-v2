'use strict'

const logger       = use('App/Services/Logger')
const Config       = use('Config')
const moment       = use('moment')
const randomString = use('randomstring')
const queryString  = use('querystring')
const crypto       = use('crypto')
const convert      = use('xml-js')
const axios        = use('axios')


/**
 * 结账控制器
 */
class CheckoutController {
  /**
   * 订单状态查询，
   * 调用微信支付订单查询接口。
   *
   * @param {Object} session 需要从会话中获取数据。
   * @return {Object} 订单查询结果。
   */
  async query ({ session }) {
    logger.info('请求查询 --------------------------------')
    // 公众账号 ID
    const appid = Config.get('wxpay.appid')

    // 商户号
    const mch_id = Config.get('wxpay.mch_id')

    // 密钥
    const key = Config.get('wxpay.key')

    // 商户订单号
    const out_trade_no = session.get('out_trade_no')

    // 随机字符
    const nonce_str = randomString.generate(32)

    // 查询订单接口
    const orderQueryApi = Config.get('wxpay.api.orderquery')

    const order ={
      appid,
      mch_id,
      out_trade_no,
      nonce_str
    }

    const sign = this.wxPaySign(order, key)
    const xmlOrder = this.orderToXML(order, sign)
    const wxPayQueryResponse = await axios.post(orderQueryApi, xmlOrder)
    const result = this.xmlToJS(wxPayQueryResponse.data)

    logger.debug(result)

    return result
  }

  /**
   *
   *
   * @param {Object} view 需要用它渲染视频。
   * @return 渲染视频。
   */
  completed ({ view }) {
    return view.render('commerce.completed')
  }

  async prePay (code) {
    const appid = Config.get('wxapp.appid')
    const secret = Config.get('wxapp.secret')
    const js_code = code
    const grant_type = 'authorization_code'

    const jsCodeToSessionParams = {
      appid,
      secret,
      js_code,
      grant_type
    }

    const jsCodeToSessionString = queryString.string(jsCodeToSessionParams)
    const jsCodeToSessionApi = Config.get('weixin.api.jsCodeToSession')
    const jsCodeToSessionUrl = `${ jsCodeToSessionApi }?${ jsCodeToSessionString }`

    const wxResponse = await axios.post(jsCodeToSessionUrl)
    const wxSession = wxResponse._data

    return wxSession
  }

  /**
   * 支付。
   *
   * @param {Object} request 请求对象，用作读取请求头部信息。
   * @param {Object} session 会话，把订单号放到会员中。
   * @return {string} 返回支付跳转链接。
   */

  async pay ({ request, session }) {
    logger.info('请求支付 ----------------------------------')

    const code = request.input('code')
    const wxSession = await this.prePay(code)
    logger.debug('微信用户会话：', wxSession)
    return code

    /** 公众账号 ID */
    const appid = Config.get('wxpay.appid')

    /** 商户号 */
    const mch_id = Config.get('wxpay.mch_id')

    /** 密钥 */
    const key = Config.get('wxpay.key')

    /** 商户订单号 */
    const out_trade_no = moment().local().format('YYYYMMDDHHmmss')
    session.put('out_trade_no', out_trade_no)

    /** 商品描述 */
    const body = 'LekeOpen'

    /** 商品价格 */
    const total_fee = 3

    /** 支付类型 */
    const trade_type = 'JSAPI'

    /** 用户 IP */
    const spbill_create_ip = request.header('x-real-ip')

    /** 商品 ID */
    const product_id = 1

    /** 通知地址 */
    const notify_url = Config.get('wxpay.notify_url')

    /** 随机字符 */
    const nonce_str = randomString.generate(32)

    /** 统一下单接口 */
    const unifiedOrderApi = Config.get('wxpay.api.unifiedorder')

    const accessToken  = session.get('accessToken')
    const openid = accessToken.openid

    /**
     * 准备支付数据。
     */

    let order = {
      appid,
      mch_id,
      out_trade_no,
      body,
      total_fee,
      trade_type,
      product_id,
      notify_url,
      nonce_str,
      spbill_create_ip,
      openid
    }
    const sign = this.wxPaySign(order, key)
    const xmlOrder = this.orderToXML(order, sign)

    /**
     * 调用微信支付统一下单接口
     */
    const wxPayResponse = await axios.post(unifiedOrderApi, xmlOrder)
    const data = this.xmlToJS(wxPayResponse.data)
    logger.debug(data)

    /**
     * JSAPI 参数
     */
     const timeStamp = moment().local().unix()
     const prepay_id = data.prepay_id
     let wxJSApiParams = {
       appId: appid,
       timeStamp: `${ timeStamp }`,
       nonceStr: nonce_str,
       package: `prepay_id=${ prepay_id }`,
       signType: 'MD5'
     }

     const paySign = this.wxPaySign(wxJSApiParams, key)

     wxJSApiParams = {
       ...wxJSApiParams,
       paySign
     }

    return wxJSApiParams
  }


  /**
   * xml 数据转换为 object
   *
   * @param {Object} xmlData 要转换的数据。
   * @return {Object} 返回转换之后的数据。
   */

  xmlToJS (xmlData) {
    /**
     * 转换 xml 数据。
     */
    const _data = convert.xml2js(xmlData, {
      compact: true,
      cdataKey: 'value',
      textKey: 'value'
    }).xml

    const data = Object.keys(_data).reduce((accumulator, key) => {
      accumulator[key] = _data[key].value
      return accumulator
    }, {})

    /**
     * 返回转换之后的结果。
     */

    return data
  }

  /**
   * object 转换为 xml 格式的数据。
   *
   * @param {Oject} order 要转换成 xml 格式的对象。
   * @param {string} sign 按微信规定算出来的签名。
   * @return 转换成 xml 格式的数据
   */
  orderToXML (order, sign) {
    /**
     * 构建需要转换的 object
     */
    order = {
      xml: {
        ...order,
        sign
      }
    }

    // 转换成 xml 格式
    const xmlOrder = convert.js2xml(order, {
      compact: true
    })

    return xmlOrder
  }

  wxPaySign (data, key) {
    /** 1. 排序。 */
    const sortedOrder = Object.keys(data).sort().reduce((accumulator, key) => {
      accumulator[key] = data[key]
      // logger.debug(accumulator)
      return accumulator
    }, {})

    /** 2. 转换成地址查询符 */
    const stringOrder = queryString.stringify(sortedOrder, null, null, {
      encodeURIComponent: queryString.unescape
    })

    /** 3. 结尾加上密钥 */
    const stringOrderWithKey = `${ stringOrder }&key=${ key }`

    /** 4. md5 后全部大写 */
    const sign = crypto.createHash('md5').update(stringOrderWithKey).digest('hex').toUpperCase()

    /**
     * 返回签名数据。
     */

    return sign
  }

  /**
   * 结账页面。
   * @param {Object} view
   * @param {Object} request 请求，需要请求里的一些数据。
   * @param {Object} response 响应，需要用到重定向。
   * @param {Object} session 会话，要在会话里存点东西。
   * @return 渲染结账页面视图。
   */
  async render ({ view, request, response, session }) {
    /**
     * 渲染结账页面视频。
     */
    return view.render('commerce.checkout')
  }

  /**
   * 处理支付结果通知。
   * 支付成功后，微信会发送支付结果给我们。
   *
   * @param {Object} request 获取到支付结果通知里的数据。
   * @return 响应微信支付系统，验证的结果。
   */
  wxPayNotify ({ request }) {
    logger.warn('处理支付结果通知------------------------')

    /**
     * 获取并处理通知里的支付结果，
     * 结果数据是 xml 格式，所以需要把它转换成 object。
     */
    const _payment = convert.xml2js(request._raw, {
      compact: true,
      cdataKey: 'value',
      textKey: 'value'
    }).xml

    const payment = Object.keys(_payment).reduce((accumulator, key) => {
      accumulator[key] = _payment[key].value
      return accumulator
    }, {})

    logger.info('支付结果：', payment)

    /**
     * 验证支付结果，
     * 可以验证支付金额与签名，
     * 这里我只验证了签名
     *
     *
     */
    const paymentSign = payment.sign

    logger.info('结果签名：', paymentSign)

    delete payment['sign']

    const key = Config.get('wxpay.key')

    const selfSign = this.wxPaySign(payment, key)

    logger.info('自制签名：', selfSign)

    /**
     * 构建回复数据，
     * 验证之后，要把验证的结果告诉微信支付系统。
     */
    const return_code = paymentSign === selfSign ? 'SUCCESS' : 'FAIL'
    logger.debug('回复代码：', return_code)

    const reply = {
      xml: {
        return_code
      }
    }

    /**
     * 响应微信支付系统，验证的结果。
     */
    return convert.js2xml(reply, {
      compact: true
    })
  }
}

module.exports = CheckoutController
