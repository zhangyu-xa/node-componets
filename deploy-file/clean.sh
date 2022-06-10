# @Author: zhangyu
# @Date:   2021-12-26 16:35:29
# @Last Modified by:   zhangyu
# @Last Modified time: 2021-12-28 15:32:15
#!/bin/bash

dir=$(ls -l ./ |awk '/^d/ {print $NF}'|grep -i $1-)

dirArr=($dir)

dirArrSort=($(
   for i in "${dirArr[@]}"
   do
      echo "$i"
   done | sort -r
))

arrLength=${#dirArrSort[*]}

rmDirArr=(${dirArrSort[*]:$2:$((arrLength-$2))})

for i in "${rmDirArr[*]}"
do
   rm -rf $i
done

exit
