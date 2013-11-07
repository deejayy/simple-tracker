"use strict";

var timeout = 60 * 3; // default announce update timeout

var peers = {};
var files = {};

function Peer(peer_id, ip, port) {
    this.peer_id = peer_id;
    this.port = port;
    this.hashes = {};
    this.closeTimer = setTimeout(this.close.bind(this), timeout * 1000);

    this.ipint = ip.split('.').reduceRight(function (previousValue, currentValue, index) {
        return +previousValue + Math.pow(256, 3 - index) * currentValue;
    });
}

Peer.prototype = {
    restart: function (mypeer) {
        clearTimeout(mypeer.closeTimer);
        mypeer.closeTimer = setTimeout(mypeer.close.bind(mypeer), timeout * 1000);
    },

    close: function () {
        clearTimeout(this.closeTimer);
        delete peers[this.peer_id];
        var h;
        for (h in this.hashes) {
            delete files[h].peers[this.peer_id];
        }
    }
};

function Conn(socket) {
    this.socket = socket;
    this.ip = this.socket.remoteAddress;
    socket.on('data', this.getData.bind(this)).setEncoding('binary');
}

Conn.prototype = {
    getData: function (data) {
        var r, req = {}, peerlist;
        if (r = data.toString('UTF-8').match(/^GET \/announce?\?(.*) HTTP\/1\./)) {
            r[1].split(/\&/).forEach(function (e) {
                var param = e.match(/(.*?)=(.*)/);
                req[param[1]] = unescape(param[2]);
            });

            peers[req['peer_id']]   = peers[req['peer_id']]   || new Peer(req['peer_id'], this.ip, +req['port']);
            files[req['info_hash']] = files[req['info_hash']] || { info_hash: req['info_hash'], peers: {}, downloaded: 0, complete: 0, incomplete: 0 };
            files[req['info_hash']]['downloaded'] += req['event'] === 'completed' ? 1 : 0;
            files[req['info_hash']]['peers'][req['peer_id']] = peers[req['peer_id']]['hashes'][req['info_hash']] = (req['event'] === 'completed' || req['left'] === 0 ? '' : 'in') + 'complete';

            Object.keys(files[req['info_hash']]['peers']).forEach(function (e) {
                files[req['info_hash']][(files[req['info_hash']]['peers'][e] !== 'complete' ? 'in' : '') + 'complete'] += 1;
            });

            peerlist = new Buffer(Object.keys(files[req['info_hash']]['peers']).length * 6);

            Object.keys(files[req['info_hash']]['peers']).forEach(function (e, i) {
                peerlist.writeUInt32BE(peers[e]['ipint'], i * 6);
                peerlist.writeUInt16BE(peers[e]['port'],  i * 6 + 4);
            });

            peers[req['peer_id']].restart(peers[req['peer_id']]);
            this.socket.write('HTTP/1.0 200 OK\r\n\r\nd8:completei' + files[req['info_hash']]['complete'] + 'e10:downloadedi' + files[req['info_hash']]['downloaded'] + 'e10:incompletei' + files[req['info_hash']]['incomplete'] + 'e8:intervali' + timeout + 'e12:min intervali60e5:peers' + peerlist.length + ':' + peerlist.toString('binary') + 'e', 'binary');
        }
        this.socket.end();
    }
};

var net = require('net');
var server = net.createServer(function (socket) {
    var connection = new Conn(socket);
}).listen(2710);
