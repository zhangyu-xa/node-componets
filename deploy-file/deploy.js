/**
 * Created by Zhangyu on 2018/3/14.
 */
const ssh2 = require("ssh2");
const through = require('through');
const fs = require("fs");
const path = require('path');

const { stdout, getTimeSlot, getFileAndDirList } = require('./utils.js');
const event = require('./events.js');

//初始化连接客户端实例
const Client = ssh2.Client;
//构造函数
function SSH2Tools({localPath,  remotePath, server}) {
	this.conn = new Client();
	this.localPath = localPath;
	this.remotePath = remotePath;
	this.server = server;
}

SSH2Tools.prototype = {
	startPublish: function(callback) {
		//创建连接
		this.connect(() => {
			//备份已有的文件
			stdout(`开始备份已有的 ${this.remotePath} 目录...`);
			this.exec(`mv ${this.remotePath} ${this.remotePath}-${getTimeSlot()} \n exit \n`, (msg1, msg2) => {
				stdout("备份成功");
				stdout("开始上传本地包文件...");
				//开始上传本地文件
				this.uploadDir(err => {
					// 触发回调
					callback && callback(err);
				});
			});
		});
	},
	startRevert: function(shLPath, shRPath, fileName, {prefix, vFlag}, callback) {
		//创建连接
		this.connect(() => {
			stdout("开始上传命令脚本");
			//开始上传子目录的命令文件
			this.uploadFile(`${shLPath}\\${fileName}`, `${shRPath}/${fileName}`, (err, result) => {
				if (err) throw err;
				stdout("上传命令脚本成功");
				stdout("开始执行回退操作...");
				//开始执行
				this.exec(`cd ${shRPath}\n chmod u+x ${fileName} \n sh ${fileName} ${prefix} ${vFlag - 1}\n rm -rf ${fileName}\n exit \n`, (err, data) => {
					callback && callback(err);
				});
			});
		});
	},
	/**
	 * 创建连接
	 * @param server - 远程linux服务器配置信息
	 * @param callback - 连接成功后的回调函数
	 */
	connect: function (callback) {
		this.conn.on("ready", () => {
			//连接就绪
			stdout(`连接服务器${this.server["host"]}成功，准备就绪....`);
			//触发回调
			callback && callback();
		}).on("error", err => {
			stdout("ssh 连接异常：", err);
		}).on("close", msg => {
			stdout("ssh 连接关闭：", msg);
		}).connect(this.server);
	},
	/**
	 * 关闭连接
	 * @param callback - 连接关闭后的回调函数
	 */
	disConnect: function (callback) {
		//触发回调
		if (callback) callback();
		//触发关闭
		this.conn.end();
	},
	/**
	 * 执行远程linux命令
	 * @param cmd - 命令正文
	 * @param callback - 回调函数
	 */
	exec: function (cmd, callback) {
		this.conn.exec(cmd, function (err, stream) {
			var data = "";
			stream.pipe(through(function onWrite(buf) {
				data = data + buf;
			}, function onEnd() {
				stream.unpipe();
			}));
			stream.on("close", function () {
				//console.log("执行命令：", cmd);
				//触发回调
				if (callback) callback(null, "" + data);
			});
		});
	},
	/**
	 * 上传文件到服务器
	 * @param localPath - 本地文件路径
	 * @param remotePath - 远程文件路径
	 * @param callback - 回调函数
	 */
	uploadFile: function (localPath, remotePath, callback) {
		this.conn.sftp(function (err, sftp) {
			if(err){
				callback(err);
			} else {
				sftp.fastPut(localPath, remotePath, function (err, result) {
					sftp.end();
					callback(err, result);
				});
			}
		});
	},
	/**
	 * 上传本地文件夹到远程linux服务器
	 * @param callback - 回调函数
	 */
	uploadDir: function (callback) {
		const dirs = [], files = [];
		//获取本地待上传的目录及文件列表
		getFileAndDirList(this.localPath, dirs, files);
		//创建远程目录
		const dirCmdFileName = "tmp_" + (new Date()).getTime() + ".sh";
		const fsCmdFile = fs.createWriteStream(dirCmdFileName);
		//遍历目录，形成命令文件
		dirs.forEach(dir => {
			const to = path.join(this.remotePath, dir.substring(this.localPath.length - 1)).replace(/[\\]/g, "/");
			const cmd = "mkdir -p \"" + to + "\"\n";
			fs.appendFileSync(dirCmdFileName, cmd, "utf8");
		});
		fsCmdFile.end();

		//遍历文件列表，形成执行函数数组
		const rFileCmdArr = [];
		this.totalFilesCount = files.length;
		files.forEach((file, pos) => {
			rFileCmdArr.push(done => {
				const to = path.join(this.remotePath, file.substring(this.localPath.length - 1)).replace(/[\\]/g, '/');
				this.uploadFile(file, to, (err, result) => {
					if(!err) {
						const progress = Math.round((pos + 1) / this.totalFilesCount * 100) + '%';
						stdout(`[${progress}] upload ${file} to ${to}`);
					}
					done(err, result);
				});
			});
		});
		//创建根目录
		this.exec("mkdir -p " + this.remotePath + " \n exit \n", (err, data) => {
			stdout("在服务器上创建根目录成功。");
			if (err) {
				callback(err);
				return;
			}
			//开始上传子目录的命令文件
			this.uploadFile(dirCmdFileName, this.remotePath + "/" + dirCmdFileName, (err, result) => {
				//删除本地的命令文件
				fs.unlinkSync(dirCmdFileName);
				if (err) throw err;
				stdout("上传目录命令文件成功。");
				//开始执行上传
				this.exec("cd " + this.remotePath + "\n sh " + dirCmdFileName + "\n rm -rf " + dirCmdFileName + "\n exit \n", (err, data) => {
					if (err) throw err;
					stdout("创建目录结构成功。");
					stdout("开始上传文件...");
					event.emit("upload", rFileCmdArr, err => {
						if (err) {
							throw err;
						}
						if (callback) callback();
					});
				});
			});
		});
	},
	execSH: function(shLPath, shRPath, fileName, {prefix, reservedNum}, callback) {
		stdout("正在清理backup...");
		//开始上传子目录的命令文件
		this.uploadFile(`${shLPath}\\${fileName}`, `${shRPath}/${fileName}`, (err, result) => {
			if (err) throw err;
			//开始执行
			this.exec(`cd ${shRPath}\n chmod u+x ${fileName} \n sh ${fileName} ${prefix} ${reservedNum}\n rm -rf ${fileName}\n exit \n`, (err, data) => {
				if(!err) stdout("清理完成");
				callback && callback(err);
			});
		});
	}
};

module.exports = SSH2Tools;