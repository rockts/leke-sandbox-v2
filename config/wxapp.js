'use strict'

const Env = use('Env')

module.export = {
  appid: Env.get('WXA_APP_ID'),
  secret: Env.get('WXA_SECRET')
}
