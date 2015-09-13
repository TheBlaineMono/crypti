var async = require('async');
var jsonSql = require('json-sql')();
jsonSql.setDialect("sqlite")
var extend = require('extend');
var sandboxHelper = require('../helpers/sandbox.js')

// private fields
var modules, library, self, private = {}, shared = {};

private.loaded = false;

//constructor
function Sql(cb, scope) {
	library = scope;
	self = this;
	self.__private = private;

	setImmediate(cb, null, self);
}

private.pass = function (obj, dappid) {
	for (var property in obj) {
		if (typeof obj[property] == "object") {
			private.pass(obj[property], dappid);
		}
		if (property == "table") {
			obj[property] = "dapp_" + dappid + "_" + obj[property];
		}
		if (property == "join" && obj[property].length === undefined) {
			for (var table in obj[property]) {
				var tmp = obj[property][table];
				delete obj[property][table];
				obj[property]["dapp_" + dappid + "_" + table] = tmp;
			}
		}
		if (property == "on" && !obj.alias) {
			for (var firstTable in obj[property]) {
				var secondTable = obj[property][firstTable];
				delete obj[property][firstTable];

				var firstTableRaw = firstTable.split(".");
				firstTable = "dapp_" + dappid + "_" + firstTableRaw[0];

				var secondTableRaw = secondTable.split(".");
				secondTable = "dapp_" + dappid + "_" + secondTableRaw[0];

				obj[property][firstTable] = secondTable;
			}
		}
	}
}

//private methods
private.query = function (action, config, cb) {
	var sql = null;
	if (action != "batch") {
		private.pass(config, config.dappid);

		var defaultConfig = {
			type: action
		};

		try {
			sql = jsonSql.build(extend({}, config, defaultConfig));
		} catch (e) {
			return done(e.toString());
		}
		function done(err, data) {
			if (err) {
				err = err.toString();
			}

			cb(err, data);
		}
	} else {
		sql = "INSERT INTO " + "dapp_" + dappid + "_" + config.table;
		var rows = [];
		config.values.forEach(function (value, rowIndex) {
			var currentRow = config.values[rowIndex];
			if (rowIndex == 1) {
				var fields = [];
				Object.keys(config.fields).forEach(function (field, index) {
					fields.push(currentRow[index] + " as '" + config.fields[field] + "'");
				});
				rows.push("select " + fields.join(","));
			} else {
				var fields = [];
				for (var i = 0; i < currentRow.length; i++){
					fields.push("'" + currentRow[i] + "'");
				}
				rows.push("select " + fields.join(","));
			}
		});
		sql = sql + " " + rows.join(" UNION ");
	}

	if (action == "select") {
		library.dbLite.query(sql.query, sql.values, null, done);
	} else if (action == "batch") {
		library.dbLite.query(sql, {}, null, done);
	} else {
		library.dbLite.query(sql.query, sql.values, done);
	}
}

//public methods
Sql.prototype.createTables = function (dappid, config, cb) {
	if (!config) {
		return cb("wrong tables format");
	}

	var sqles = [];
	for (var i = 0; i < config.length; i++) {
		config[i].table = "dapp_" + dappid + "_" + config[i].table;
		if (config[i].type == "table") {
			config[i].type = "create";
		} else if (config[i].type == "index") {
			config[i].type = "index";
		} else {
			return setImmediate(cb, "Unknown table type: " + config[i].type);
		}

		var sql = jsonSql.build(config[i]);
		sqles.push(sql.query);
	}

	async.eachSeries(sqles, function (command, cb) {
		library.dbLite.query(command, function (err, data) {
			cb(err, data);
		});
	}, function (err) {
		setImmediate(cb, err, self);
	});
}

/*
 Drop tables functional
 */
Sql.prototype.dropTables = function (dappid, config, cb) {
	var tables = [];
	for (var i = 0; i < config.length; i++) {
		config[i].table = "dapp_" + dappid + "_" + config[i].table;
		tables.push({name: config[i].table.replace(/[^\w_]/gi, ''), type: config[i].type});
	}

	async.eachSeries(tables, function (table, cb) {
		if (table.type == "create") {
			library.dbLite.query("DROP TABLE IF EXISTS " + table.name, function (err, rows) {
				setImmediate(cb, err);
			});
		} else if (table.type == "index") {
			library.dbLite.query("DROP INDEX IF EXISTS " + table.name, function (err, rows) {
				setImmediate(cb, err);
			})
		} else {
			setImmediate(cb);
		}
	}, cb);
}

Sql.prototype.sandboxApi = function (call, args, cb) {
	sandboxHelper.callMethod(shared, call, args, cb);
}

//events
Sql.prototype.onBind = function (scope) {
	modules = scope;
}

Sql.prototype.onBlockchainReady = function () {
	private.loaded = true;
}

//shared
shared.select = function (req, cb) {
	var config = extend({}, req.body, {dappid: req.dappid});
	private.query.call(this, "select", config, cb);
}

shared.batch = function (req, cb) {
	var config = extend({}, req.body, {dappid: req.dappid});
	private.query.call(this, "batch", config, cb);
}

shared.insert = function (req, cb) {
	var config = extend({}, req.body, {dappid: req.dappid});
	private.query.call(this, "insert", config, cb);
}

shared.update = function (req, cb) {
	var config = extend({}, req.body, {dappid: req.dappid});
	private.query.call(this, "update", config, cb);
}

shared.remove = function (req, cb) {
	var config = extend({}, req.body, {dappid: req.dappid});
	private.query.call(this, "remove", config, cb);
}

module.exports = Sql;