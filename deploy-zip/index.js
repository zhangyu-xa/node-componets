/*
* @Author: zhangyu
* @Date:   2021-12-25 20:46:39
* @Last Modified by:   zhangyu
* @Last Modified time: 2022-06-17 16:38:22
* @Email: zhangyu6936@fiberhome.com
*/
const child_process = require('child_process');
const dotenv = require('dotenv');
const path = require('path');
const compressing = require('compressing');
const { stdout, getTimeSlot, createLocalFile, getHelpInfo } = require('./utils.js');
const SSH2Tools = require('./deploy.js');

dotenv.config();

let ssh2Tool = null;
let config = {};
let isForceMode = process.env.npm_config_force === "true";
let isRevertScene = process.env.npm_config_revert === "true";
let isLogScene = process.env.npm_config_log === "true";

/**
 * 初始化上下文变量
 *
 * @param  {[object]} conf 本地配置文件
 * @return {[object]}      context
 */
function init(conf, mode) {
	// 释放链接
	if(ssh2Tool) ssh2Tool.disConnect();
	// 初始化局部变量
	config = conf;
	// 实现链式调用
	return this;
}

function start() {
	// 获取部署配置信息
	getDeployConfig().then(sysConf => {
		//创建ssh2Tool实例
		ssh2Tool = new SSH2Tools(sysConf);

		// 触发回滚，目前只支持回滚到上一次
		if(isRevertScene) {
			startRevert(sysConf);
			return;
		}

		// 显示更新日志
		if(isLogScene) {
			showDeployLog(sysConf);
			return;
		}
		
		// 触发远程发布
		startPublish(sysConf, isForceMode);
	}, err => {
		stdout(err, true);
	});
}
/**
 * 发布启动逻辑
 */
function dealPublish () {
	const distPath = localPath.replace(/\\/gi, '/');
	stdout(`部署目标服务器IP：${server.host}\n待部署的本地目录：${distPath}\n部署到服务器目录：${remotePath}\n启动发布流程...\n\n`, true);
	// 创建本地压缩包
	stdout(`创建本地压缩包文件`);
	const zipFileName = `${distPath.split("/").pop()}.zip`;
	const zipLPath = distPath.substring(0, distPath.lastIndexOf("/"));
	compressing.zip.compressDir(distPath, `${zipLPath}/${zipFileName}`).then(() => {
		stdout(`创建本地压缩包文件成功`);
		ssh2Tool.startPublish(zipLPath, remotePath, zipFileName, err => {
			if(err) {
				stdout(`发布失败！！！`, true);
				process.exit();
			} else {
				// 更新发布日志, 清理备份目录
				Promise.all([updateDeployLog(remotePath), cleanBackupDirs(remotePath)]).then(() => {}, () => {}).finally(res => {
					stdout(`发布成功！！！`, true);
					process.exit();
				});
			}
		});
	}).catch(err => {
		stdout(`创建本地压缩包文件失败`);
	});
};

function cleanBackupDirs(remotePath) {
	return new Promise((resolve, reject) => {
		// 获取参数 
		const reservedNum = 3;// 3，保留备份的目录个数，后续可以扩展npm cooked参数，TODO
		const shellFileName = "clean.sh";
		// 上传sh到服务器
		const shRPath = remotePath.substring(0, remotePath.lastIndexOf("/"));
		const shLPath = path.join(__dirname, "../", "deploy");

		// 组装参数
		const shParams = {
			prefix: remotePath.split("/").pop(),
			reservedNum
		}
		ssh2Tool.cleanBackupDirs(shLPath, shRPath, shellFileName, shParams, err => {
			if (err) {
				reject()
			} else {
				resolve();
			}
		});
	});
}

function updateDeployLog(remotePath) {
	return new Promise((resolve, reject) => {
		const deployLogPath = remotePath.substring(0, remotePath.lastIndexOf("/"));
		ssh2Tool.exec(`cat ${remotePath}/deploy.log ${deployLogPath}/deploy.log >> ${deployLogPath}/temp.log \n mv ${deployLogPath}/temp.log -f ${deployLogPath}/deploy.log  \n exit \n`, (err, data) => {
			if (err) {
				reject()
			} else {
				resolve();
			}
		});
	});
}

function checkWorkSpace(isForceMode) {
	return new Promise((resolve, reject) => {
		isForceMode ? resolve() : child_process.exec("git status -s", { 'encoding': 'utf-8', 'cwd': process.cwd() }, (error, stdout, stderr) => {
            if(error || stderr) reject(error || stderr);
            if(stdout) reject("error: 当前工作区仍有未提交或者未纳入版本控制的文件，请确保工作干净后再开始部署");
            resolve();
        });
	});
}

function getGitInfos() {
	const cmd = `git name-rev --name-only HEAD && 
				 git rev-parse HEAD && 
				 git config --get user.name && 
				 git config --get user.email
				`;
	try {
		return child_process.execSync(cmd.replace(/\n/gm,""), { 
			'cwd': process.cwd(),
			'encoding': 'utf-8' 
		}).split("\n");
	} catch (e) { 
		// 静默处理异常
		stdout("warn: can't get git information.", true);
		return [];
	}
}

function getDeployConfig() {
	const sysName = process.env.npm_package_name;
	const version = process.env.npm_package_version;
	const { localPath, servers, default: defaultServer } = config;
	// 默认取.env中的值，如果没有则取默认值
	const deployServer = process.env.Deploy_Server || defaultServer;

	return new Promise((resolve, reject) => {
		if(!deployServer) reject(`未检测到项目 ${sysName} 部署配置信息，请添加并确认`);
		if(!servers[deployServer]) reject(`1.未检测到项目 ${sysName} 关于远程目标服务器 ${deployServer} 的部署配置信息\n2.请确认.env文件的Deploy_Server节点配置是否正确`);
		
		resolve({ sysName, version, localPath, ...servers[deployServer] });
	});
}

function injectDeployInfo(sysName, {localPath}) {
	// 获取本地git参数
	const gitInfos = getGitInfos();
	if(gitInfos.length > 0) {
		const [branchName, commitID, user, email] = gitInfos;
		const msg = `发布人：${user}（${email}）\n分支名称：${branchName}\n最后一次提交的 commitID: ${commitID}\n\n`;
		stdout(msg, true);
		// 注入版本信息
		createLocalFile(localPath, `时间：${getTimeSlot()}\n发布工程：${sysName}\n${msg}`, "deploy.log");
	}
}

function startPublish({sysName, version, ...sysConf}, isForceMode) {
	//判断工作区是否干净
	checkWorkSpace(isForceMode).then(() => {
		stdout(`部署的工程名：${sysName} (version：${version})\n`, true);
		// 准备变更信息
		injectDeployInfo(sysName, sysConf);
		// 开始发布动作
		dealPublish(sysConf);
	}, err => {
		stdout(err, true);
	});
}

function startRevert({sysName, localPath,  remotePath, server}) {
	// 获取参数 
	const vFlag = 1;// 1，标识回退到上一个版本，后续可以扩展npm cooked参数，TODO
	const shellFileName = "revert.sh";
	// 上传sh到服务器
	const shRPath = remotePath.substring(0, remotePath.lastIndexOf("/"));
	const shLPath = path.join(__dirname, "../", "deploy");

	// 组装参数
	const shParams = {
		prefix: remotePath.split("/").pop(),
		vFlag
	}

	stdout(`正在将工程 ${sysName} 回退到上一个版本...`);
	ssh2Tool.startRevert(shLPath, shRPath, shellFileName, shParams, err => {
		if(err){
		 	stdout(`${err}\n\n回退失败！！！`, true);
		 	process.exit();
		} else {
			stdout("\n\n回退成功！！！", true);
			// 更新发布日志
			const gitInfos = getGitInfos();
			if(gitInfos.length > 0) {
				const [,,user, email] = gitInfos;
				const log = `时间：${getTimeSlot()}\\n回退工程：${sysName}\\n执行人：${user}（${email}）\\n\\n`;
				ssh2Tool.exec(`cd ${shRPath}\n sed -i "1i${log}" deploy.log \n exit \n`, (err, data) => {
					process.exit();
				});
			} else {
				process.exit();
			}
		}
	});
}

function showDeployLog() {
	// body...
}

/**
 * 校验命令是否合法
 * @param  {[boolean]} isLegal 是否合法
 * @return {[boolean]}         校验是否通过
 */
function checkNpmCmd(isLegal) {
	const npmCooked = JSON.parse(process.env.npm_config_argv)["cooked"];
	return !(npmCooked.length > 3 || 
		(npmCooked.length === 3 && !isLegal) || 
		(npmCooked.length === 3 && isLegal && npmCooked[2].indexOf("--") < 0));
}

/*(function () {
	console.log("here");
	const isRevertScene = process.env.npm_config_revert || false;
	const isLogScene = process.env.npm_config_log || false;
	const isForceMode = process.env.npm_config_force || false;
	
	// console.log(JSON.parse(process.env.npm_config_argv)["cooked"]);
	// console.log(process.env);
	// return;
	// 检查命令参数是否合法
	if(!checkNpmCmd(isRevertScene || isLogScene || isForceMode)) {
		stdout(getHelpInfo(), true);
		return;
	}

	// 获取工程名称
	const sysName = `fitmgr-${process.env.npm_package_name}`;

	// 获取部署配置信息
	getDeployConf(sysName).then(sysConf => {
		if(ssh2Tool) ssh2Tool.disConnect();
		//创建ssh2Tool实例
		ssh2Tool = new SSH2Tools(sysConf);

		// 触发回滚，目前只支持回滚到上一次
		if(isRevertScene) {
			startRevert(sysConf);
			return;
		}

		// 显示更新日志
		if(isLogScene) {
			showDeployLog(sysConf);
			return;
		}
		
		// 触发远程发布
		startPublish(sysConf, isForceMode);
	}, err => {
		stdout(err, true);
	});
})();*/
exports.init = init;
exports.start = start;