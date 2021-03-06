'use strict'


const noble = require('noble')
const devices = require('./devices')
const FirmwareUpdater = require('./firmware-updater').FirmwareUpdater
const SketchUploader = require('./sketch-uploader').SketchUploader
const events = require('events')
const logger = require('./util/logs').logger
const async = require('async')

const NOBLE_STATE_READY = 'poweredOn'


class LightBlueSDK extends events.EventEmitter {
  /**
   * Core LightBlue SDK class
   *
   * This class implements the EventEmitter which allows clients to register
   * for events using the .on() method. Events include:
   *
   *    - "discover"
   *
   */

  constructor() {
    super()

    // Dependencies
    this._fwUpdater = new FirmwareUpdater(this)
    this._sketchUploader = new SketchUploader()

    // State
    this._devices = {}
    this._scanning = false
    this._scanTimeout = null

    noble.on('discover', (peripheral)=> {
      this._discover(peripheral)
    })
  }

  _autoReconnect(device) {
    logger.info(`Auto reconnecting to ${device.getName()}`)
    device.connect((err)=> {
      if (err) {
        logger.info(`Error reconnecting to ${device.getName()}`)
      }
      else {
        logger.info(`Auto reconnect to ${device.getName()} success`)
        if (this._fwUpdater.isInProgress(device)) {
          logger.info('Auto-reconnected to device in middle of FW update')

          device.lookupServices((err)=> {
            this._fwUpdater.continueUpdate()
          })

        }
      }
    })
  }

  _discover(peripheral) {
    /**
     * A new BLE peripheral device has been discovered (from Noble)
     */

    if (this._devices[peripheral.uuid]) {
      // We already have a record of this device

      let device = devices.fromExistingDevice(this._devices[peripheral.uuid], peripheral)
      if (device.autoReconnect() && !device.isConnectedOrConnecting()) {
        this._autoReconnect(device)
      }

    } else {
      // We don't have a record of this device

      let device = devices.fromNoblePeripheral(peripheral)
      if (device.getType() === devices.DEVICE_TYPE_LIGHT_BLUE) {
        this._devices[device.getAddress()] = device
        this.emit('discover', device)
      }
    }

  }

  quitGracefully(callback) {
    let disconnects = []

    this.stopScanning()

    Object.keys(this._devices).forEach((key)=> {
      let d = this._devices[key]
      disconnects.push((disconnectCallback)=> {
        d.disconnect(disconnectCallback)
      })
    })

    async.parallel(disconnects, function (error, results) {
      logger.info('All devices have disconnected')
      callback(error)
    })
  }

  reset() {
    logger.info('Disconnected all devices!')
    this._disconnectDevices()
    logger.info('Clearing device cache!')
    this._devices = {}
    this._fwUpdater.resetState()
  }

  startScanning(timeoutSeconds=30, timeoutCallback=null) {
    /**
     * Start a BLE scan for a given period of time
     *
     * @param timeout int Number of seconds to scan
     * @param timeoutCallback Function called back after scan timeout
     */

    let ctx = this

    if (noble.state === NOBLE_STATE_READY) {
      logger.info('Starting to scan...')
      noble.startScanning([], true)
      this._scanning = true
    } else {
      noble.on('stateChange', function (state) {
        if (state === NOBLE_STATE_READY) {
          logger.info('Starting to scan...')
          noble.startScanning([], true)
          this._scanning = true
        }
      })
    }

    logger.info(`Setting scan timeout: ${timeoutSeconds} seconds`)
    this._scanTimeout = setTimeout(()=> {
      logger.info("Scan timeout!")
      ctx.stopScanning()
      if (timeoutCallback) {
        timeoutCallback()
      }
    }, timeoutSeconds * 1000)
  }

  stopScanning() {
    logger.info('No longer scanning...')
    clearTimeout(this._scanTimeout)
    noble.stopScanning()
    this._scanning = false
  }

  getDeviceForUUID(uuid) {
    return this._devices[uuid]
  }

  /**
   * Update a devices firmware
   *
   * @param device LightBlue Device object
   * @param bundle an array of firmware images
   */
  updateFirmware(device, bundle, force, callback) {
    this._fwUpdater.beginUpdate(device, bundle, force, callback)
  }

  uploadSketch(device, sketchBuf, sketchName, promptUser, callback) {
    this.stopScanning()
    this._sketchUploader.beginUpload(device, sketchBuf, sketchName, promptUser, callback)
  }

  /**
   * Connect to a device, preserving scanning state
   *
   * This method exists on the LB object by design, in addition to the Device object itself.
   * This is because Noble will not connect to a device while scanning is enabled, therefore
   * we stop scanning, connect to the device, and then set scanning back to it's original state.
   *
   * @param uuid string UUID of device
   * @param callback Function with one error param
   */
  connectToDevice(uuid, callback) {
    let d = this._devices[uuid]
    if (d) {
      let originalScanningState = this._scanning
      this.stopScanning()
      d.connect((err)=> {
        if (originalScanningState === true)
          this.startScanning()
        callback(err)
      })
    } else {
      callback(`No device: ${uuid}`)
    }
  }

}


let sdk = null


function getSdk() {
  if (!sdk) {
    sdk = new LightBlueSDK()
  }

  return sdk
}


module.exports = {
  sdk: getSdk()
}
