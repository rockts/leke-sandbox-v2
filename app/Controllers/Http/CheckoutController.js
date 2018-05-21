'use strict'

const logger = use('App/Services/Logger')

class CheckoutController {
  render ({ view }) {
    logger.debug('debug log')
    return view.render('commerce.checkout')
  }
}

module.exports = CheckoutController
