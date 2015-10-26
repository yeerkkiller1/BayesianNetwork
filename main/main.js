/// <amd-dependency path="SharedTS/content/SharedTS/browser/FirebaseRead.js">
/// <amd-dependency path="SharedTS/content/SharedTS/browser/FirebaseReadShallow.js">
/// <amd-dependency path="SharedTS/content/SharedTS/browser/syncUrl.js">
/// <amd-dependency path="SharedTS/content/SharedTS/browser/SyncVariable.js">
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
define(["require", "exports", "SharedTS/content/SharedTS/browser/Directive", "underscore", "angular", "SharedTS/content/SharedTS/browser/FirebaseRead.js", "SharedTS/content/SharedTS/browser/FirebaseReadShallow.js", "SharedTS/content/SharedTS/browser/syncUrl.js", "SharedTS/content/SharedTS/browser/SyncVariable.js", "SharedTS/content/SharedTS/browser/objIntegrate.js"], function (require, exports, Directive, _, angular) {
    function hashCode(text) {
        var hash = 0, i, chr, len;
        if (text.length == 0)
            return hash;
        for (i = 0, len = text.length; i < len; i++) {
            chr = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; // Convert to 32bit integer
        }
        return hash;
    }
    ;
    function hsl(h, s, l) {
        return "hsl(" + h + ", " + s + "%, " + l + "%)";
    }
    function permute(arr, curCount, maxCounts) {
        if (curCount >= maxCounts.length)
            return [arr];
        var max = maxCounts[curCount];
        var arrs = [];
        for (var ix = 0; ix < max; ix++) {
            var newArr = arr.slice(0);
            newArr.push(ix);
            permute(newArr, curCount + 1, maxCounts).forEach(function (newFullArr) {
                arrs.push(newFullArr);
            });
        }
        return arrs;
    }
    function parseData(xml) {
        var xmlData = xmlIsDumb(dumbXMLParser(xml).obj, {});
        xmlData = xmlData["?xml"]["BIF"]["NETWORK"];
        //PROPERTY = "position = (7591.46923828125, 5166.06396484375)"
        var variables = xmlData["VARIABLE"];
        var factors = xmlData["DEFINITION"];
        var nodes = variables.map(function (variableRAW) {
            var variable = {
                name: variableRAW.NAME,
                valuePossible: variableRAW.OUTCOME
            };
            var posParts = variableRAW.PROPERTY.split(new RegExp("(\\(|,| |\\)|=)+"));
            var posX = +posParts[2];
            var posY = +posParts[4];
            return {
                variable: variable,
                displayPos: { x: posX, y: posY },
                directFactors: {
                    variables: []
                },
                parents: {},
                children: {},
                childDependent: {}
            };
        });
        //Create node lookup
        var nodeLookup = {};
        nodes.forEach(function (node) {
            nodeLookup[node.variable.name] = node;
        });
        //Add factors
        factors.forEach(function (factor) {
            var given = factor.GIVEN;
            given = given || [];
            if (!given["push"]) {
                given = [given];
            }
            var givenVariables = given.map(function (name) { return nodeLookup[name].variable; });
            var variableMaxes = givenVariables.map(function (x) { return x.valuePossible.length; });
            var tableIndexes = permute([], 0, variableMaxes);
            var factorVariable = nodeLookup[factor.FOR].variable;
            var node = nodeLookup[factor.FOR];
            var tableValues = factor.TABLE.split(" ");
            for (var ix = 0; ix < tableValues.length; ix += factorVariable.valuePossible.length) {
                var chance = {
                    valueChance: [],
                    valuePossible: [],
                    invalidFrac: 0
                };
                for (var iy = 0; iy < factorVariable.valuePossible.length; iy++) {
                    chance.valueChance.push(+tableValues[ix + iy]);
                    chance.valuePossible.push(factorVariable.valuePossible[iy]);
                }
                var tableIndex = tableIndexes[ix / factorVariable.valuePossible.length];
                var values = tableIndex.map(function (valueIndex, varIndex) {
                    var variable = givenVariables[varIndex];
                    return { name: variable.name, valueIndex: valueIndex, valuePossible: variable.valuePossible };
                });
                node.directFactors.variables.push({
                    chance: chance,
                    values: values
                });
            }
        });
        //Populate parents and children
        nodes.forEach(function (node) {
            node.directFactors.variables[0].values.forEach(function (value) {
                var parentNode = nodeLookup[value.name];
                node.parents[parentNode.variable.name] = parentNode;
                parentNode.children[node.variable.name] = node;
            });
        });
        return nodes;
    }
    function parseUntil(pos, text, ch) {
        var regExp = typeof ch === "object";
        var reg = ch;
        while (pos < text.length) {
            if (regExp && reg.exec(text[pos]))
                return pos;
            if (!regExp && text[pos] === ch)
                return pos;
            pos++;
        }
        return pos;
    }
    function parseUntilMultiple(pos, text, chs) {
        for (var ix = 0; ix < chs.length; ix++) {
            pos = parseUntil(pos, text, chs[ix]);
        }
        return pos;
    }
    function enumerateNodesChildren(node, fnc) {
        var visited = {};
        var toVisit = [];
        toVisit.push(node);
        visited[node.variable.name] = true;
        while (toVisit.length > 0) {
            var node = toVisit.splice(0, 1)[0];
            fnc(node);
            _.values(node.children).forEach(function (neighbour) {
                if (neighbour.variable.name in visited)
                    return;
                visited[neighbour.variable.name] = true;
                toVisit.push(neighbour);
            });
        }
    }
    //down is true, if we just traveled downwards (so to a child)
    function enumerateNodes(startNode, fnc, justChildren, justParents, skipFirst) {
        var visited = {};
        var toVisit = [];
        toVisit.push({ n: startNode, down: true });
        visited[startNode.variable.name] = true;
        while (toVisit.length > 0) {
            var nodeObj = toVisit.splice(0, 1)[0];
            ;
            var node = nodeObj.n;
            if (!skipFirst || node !== startNode) {
                var returnVal = fnc(node, nodeObj.down);
                if (returnVal === false)
                    continue;
            }
            var neighbours = [];
            if (!justParents) {
                neighbours = neighbours.concat(_.values(node.children).map(function (n) { return { n: n, down: true }; }));
            }
            if (!justChildren) {
                neighbours = neighbours.concat(_.values(node.parents).map(function (n) { return { n: n, down: false }; }));
            }
            neighbours.forEach(function (neighbourObj) {
                var neighbour = neighbourObj.n;
                if (neighbour.variable.name in visited)
                    return;
                visited[neighbour.variable.name] = true;
                toVisit.push(neighbourObj);
            });
        }
    }
    function getNodes(node, fnc) {
        var nodes = {};
        enumerateNodes(node, function (n) {
            if (fnc(n)) {
                nodes[n.variable.name] = n;
            }
        });
        return nodes;
    }
    function getRoots(node) {
        return getNodes(node, function (n) { return _.isEmpty(n.parents); });
    }
    function normalizeChances(chances) {
        var sum = 0;
        chances.forEach(function (x) { return sum += x || 0; });
        return chances.map(function (x) { return x / sum; });
    }
    function simulateOnce(target, roots) {
        var toVisit = _.map(roots, function (x) { return x; });
        //var visited: { [name: string]: boolean } = {};
        var values = {};
        var visited = {};
        _.forEach(roots, function (x) {
            visited[x.variable.name] = true;
        });
        while (toVisit.length > 0) {
            var node = toVisit.splice(0, 1)[0];
            //Calculate our value
            var chances = node.directFactors.variables.filter(function (varChance) {
                return _.all(varChance.values, function (variable) {
                    var outcome = variable.valuePossible[variable.valueIndex];
                    return values[variable.name] === outcome;
                });
            });
            var chance = chances[0].chance;
            var cdf = [];
            var sum = 0;
            var p = Math.random();
            var index = 0;
            var idk = normalizeChances(chance.valueChance);
            for (var k in idk) {
                var frac = idk[k];
                if (p < sum) {
                    break;
                }
                index = +k;
                sum += frac;
            }
            if (node.variable.valueIndex !== undefined) {
                if (node.variable.valueIndex !== index) {
                    return null;
                }
            }
            values[node.variable.name] = node.variable.valuePossible[index];
            //Check if any children can now be triggered (and have not been visited)
            _.forEach(node.children, function (child) {
                if (child.variable.name in values) {
                    throw new Error("Uh... triggered twice?");
                }
                if (_.all(child.parents, function (c) { return c.variable.name in values; })) {
                    toVisit.push(child);
                    visited[child.variable.name] = true;
                }
            });
        }
        return values[target.variable.name];
    }
    function factorOf(node, values, oneOnMissingValue) {
        var name = node.variable.name;
        if (node.variable.valueIndex !== undefined) {
            var value = node.variable.valuePossible[node.variable.valueIndex];
            if (value !== values[name]) {
                //Hmm... I don't think this should happen
                debugger;
            }
        }
        var matches = node.directFactors.variables.filter(function (variable) {
            return _.all(variable.values, function (value) { return value.valuePossible[value.valueIndex] === values[value.name]; });
        });
        if (matches.length !== 1) {
            if (oneOnMissingValue) {
                return 1;
            }
            throw new Error("Invalid numbers of matches, this means values is incomplete.");
        }
        var chance = matches[0].chance;
        var currentIndex = -1;
        chance.valuePossible.forEach(function (possible, index) {
            if (possible === values[node.variable.name]) {
                currentIndex = index;
            }
        });
        return chance.valueChance[currentIndex];
    }
    function chanceOf(nodeLookup, values, 
        //If it is correct in any cases where we can't find a value needed to get a factor, we skip the factor.
        //	Otherwise we will throw errors if we think it has problems.
        valuesIsCorrect) {
        /*
    C B A
    T T T  0.5 * 0.9 * 0.7 = 0.315
    T T F  0.5 * 0.9 * 0.3 = 0.135
    T F T  0.5 * 0.1 * 0.4 = 0.020
    T F F  0.5 * 0.1 * 0.6 = 0.030
    F T T  0.5 * 0.4 * 0.7 = 0.140
    F T F  0.5 * 0.4 * 0.3 = 0.060
    F F T  0.5 * 0.6 * 0.4 = 0.120
    F F F  0.5 * 0.6 * 0.6 = 0.180
    
    (P(C, B, A) + P(!C, B, A)) / (P(C, B, A) + P(!C, B, A) + P(C, !B, A) + P(!C, !B, A))
    (P(C, B, A) + P(!C, B, A)) / P(A = T)
    (P(C, B, A) + P(!C, B, A)) / P(A = T)
    
    P(B=T) = P(C, B, A) + P(C, B, !A) + P(!C, B, A) + P(!C, B, !A) = 0.65
    B(B=T|A=T) = 0.765
    
    P(A=T) = 0.595
        */
        var chance = 1;
        _.forEach(values, function (value, name) {
            chance *= factorOf(nodeLookup[name], values, valuesIsCorrect);
        });
        return chance;
    }
    function calculate(node, relevantNodes, nodeLookup, relevantIsCorrect) {
        //relevantNodes = [ nodeLookup["H"] ];
        var outcomes = {};
        if (node.variable.valueIndex !== undefined) {
            outcomes[node.variable.valuePossible[node.variable.valueIndex]] = 1;
        }
        else {
            relevantNodes = relevantNodes.filter(function (x) { return x !== node; });
            var unsetNodes = relevantNodes.filter(function (x) { return x.variable.valueIndex === undefined; });
            var setNodes = relevantNodes.filter(function (x) { return x.variable.valueIndex !== undefined; });
            //Permute all values of unsetNodes
            var relevantVariables = unsetNodes.map(function (node) { return node.variable; });
            var variableMaxes = relevantVariables.map(function (x) { return x.valuePossible.length; });
            var variableIndexes = permute([], 0, variableMaxes);
            variableIndexes.forEach(function (indexes) {
                var values = {};
                indexes.forEach(function (valueIndex, variableIndex) {
                    var variable = relevantVariables[variableIndex];
                    var value = variable.valuePossible[valueIndex];
                    values[variable.name] = value;
                });
                setNodes.forEach(function (setNode) {
                    var variable = setNode.variable;
                    values[variable.name] = variable.valuePossible[variable.valueIndex];
                });
                //Permute all values of node
                var nodeName = node.variable.name;
                node.variable.valuePossible.forEach(function (nodeValue) {
                    values[nodeName] = nodeValue;
                    outcomes[nodeValue] = outcomes[nodeValue] || 0;
                    outcomes[nodeValue] += chanceOf(nodeLookup, values, relevantIsCorrect);
                });
            });
        }
        var dist = node.variable.valuePossible.map(function (outcome) { return outcomes[outcome] || 0; });
        return {
            valueChance: normalizeChances(dist),
            valuePossible: node.variable.valuePossible,
            invalidFrac: 0
        };
    }
    function getAbsoluteChance(node, simulations) {
        //Get the absolute chances of our parents
        var outcomes = {};
        var invalidCount = 0;
        var roots = getRoots(node);
        for (var ix = 0; ix < simulations; ix++) {
            var outcome = simulateOnce(node, roots);
            if (outcome === null) {
                invalidCount++;
                continue;
            }
            outcomes[outcome] = outcomes[outcome] || 0;
            outcomes[outcome]++;
        }
        var dist = node.variable.valuePossible.map(function (outcome) { return outcomes[outcome] || 0; });
        return {
            valueChance: normalizeChances(dist),
            valuePossible: node.variable.valuePossible,
            invalidFrac: invalidCount / simulations
        };
    }
    function setChildDependents(node) {
        _.forEach(node.children, function (node) {
            if (node.variable.valueIndex !== undefined) {
            }
        });
    }
    function chanceToString(chance) {
        var parts = [];
        chance.valueChance.forEach(function (x, index) {
            parts.push(chance.valuePossible[index] + "=" + chance.valueChance[index].toFixed(10));
        });
        return parts.join(" ");
    }
    function chanceEqual(a, b) {
        return chanceToString(a) === chanceToString(b);
    }
    var Base = (function (_super) {
        __extends(Base, _super);
        function Base() {
            _super.apply(this, arguments);
            this.templateUrl = "main/main.html";
            this.cssUrl = "main/main.css";
            this.nodeWidth = 0.25;
            this.nodeHeight = 0.25;
            this.showFactors = true;
            this.showChances = true;
            this.simulationCount = 25000;
            this.checkCount = 10;
        }
        Base.prototype.unobserveAll = function () {
            this.data.forEach(function (n) {
                n.variable.valueIndex = undefined;
            });
        };
        Base.prototype.num = function (x) {
            var epsilon = 1000000;
            return Math.round(x * epsilon) / epsilon;
        };
        Base.prototype.observeRandom = function () {
            this.unobserveAll();
            //Eh.. sort of, but not really, because I am lazy
            var observeCount = ~~(Math.random() * this.data.length);
            while (observeCount-- > 0) {
                var pos = ~~(Math.random() * this.data.length);
                var node = this.data[pos];
                if (node.variable.valueIndex !== undefined)
                    continue;
                node.variable.valueIndex = ~~(Math.random() * node.variable.valuePossible.length);
            }
        };
        Base.prototype.calculateAll = function () {
            var _this = this;
            this.data.forEach(function (n) {
                _this.calculateChanceHeuristic(n);
            });
        };
        Base.prototype.checkNTimes = function (N) {
            for (var ix = 0; ix < N; ix++) {
                this.observeRandom();
                this.calculateAll();
            }
        };
        Base.prototype.selectNode = function (node) {
            console.log(node);
            this.data.forEach(function (n) { return n.isRelevant = false; });
            this.data.forEach(function (n) { return n.isPotentialRelevant = false; });
            if (this.selectedNode === node) {
                this.selectedNode = null;
            }
            else {
                this.selectedNode = node;
            }
        };
        Base.prototype.simulateChance = function (node) {
            node.absoluteChance = getAbsoluteChance(node, this.simulationCount);
        };
        //These should really also adjust the probabilities on the nodes, as it may be that removing them has no effect,
        //	but that in general it would, it just happens to be that the current probabilities exactly work out. 
        Base.prototype.markPotentialRelevant = function (node) {
            this.data.forEach(function (n) { return n.isRelevant = false; });
            this.data.forEach(function (n) { return n.isPotentialRelevant = false; });
            //See which nodes we can toggle in order to get a change in chance
            var nodes = this.data.slice();
            var baseChance = calculate(node, nodes, this.nodeLookup);
            for (var ix = 0; ix < nodes.length; ix++) {
                var testNode = nodes[ix];
                if (testNode === node)
                    continue;
                var testVariable = testNode.variable;
                testNode.isPotentialRelevant = false;
                //Try all values to see if any of them change the chance
                var startIndex = testVariable.valueIndex;
                testVariable.valueIndex = undefined;
                try {
                    var testChance = calculate(node, nodes, this.nodeLookup);
                    if (!chanceEqual(baseChance, testChance)) {
                        testNode.isPotentialRelevant = true;
                        continue;
                    }
                    for (var index = 0; index < testVariable.valuePossible.length; index++) {
                        testVariable.valueIndex = index;
                        var testChance = calculate(node, nodes, this.nodeLookup);
                        if (!chanceEqual(baseChance, testChance)) {
                            testNode.isPotentialRelevant = true;
                            break;
                        }
                    }
                }
                finally {
                    testVariable.valueIndex = startIndex;
                }
            }
        };
        Base.prototype.markRelevant = function (node) {
            this.data.forEach(function (n) { return n.isRelevant = false; });
            this.markPotentialRelevant(node);
            //See which nodes we can remove in order to get a change in chance
            var nodes = this.data.slice();
            var baseChance = calculate(node, nodes, this.nodeLookup);
            for (var ix = 0; ix < nodes.length; ix++) {
                var testNode = nodes[ix];
                if (testNode === node)
                    continue;
                var testVariable = testNode.variable;
                testNode.isRelevant = false;
                if (!testNode.isPotentialRelevant)
                    continue;
                var nodesToRemove = {};
                nodesToRemove[testNode.variable.name] = true;
                //Remove testNode, and all descendants, up until descendants that are set
                enumerateNodes(testNode, function (descendant) {
                    if (descendant.variable.valueIndex !== undefined) {
                        return false;
                    }
                    nodesToRemove[descendant.variable.name] = true;
                }, true);
                var subNodes = nodes.filter(function (n) { return !nodesToRemove[n.variable.name]; });
                try {
                    var testChance = calculate(node, subNodes, this.nodeLookup);
                    testNode.isRelevant = !chanceEqual(baseChance, testChance);
                }
                catch (err) {
                    //Eh... means we can't calculate the chance without it... so it IS relevant
                    testNode.isRelevant = true;
                }
            }
            this.data.forEach(function (n) { return n.isPotentialRelevant = false; });
        };
        Base.prototype.markHeuristicRelevant = function (node) {
            this.data.forEach(function (n) { return n.isRelevant = false; });
            this.data.forEach(function (n) { return n.isPotentialRelevant = false; });
            //We should really use this heuristic... but I probably won't
            //If parent(s) are independent, you can calculate their probabilities and go from those
            //	They could be independent as a nature of the graph, OR they could be known values
            //Parents are relevant, up to observed value
            //Descendants of a parent that are observed (and the chain to them) are relevant
            //	If the ancestors of an observed contain an ancestor of the target, all the ancestors are relevant
            //But always, if the connection is only through an observed node, it doesn't count
            var allRelevant = {};
            //Explicitly removed from other lists, as everywhere we check for existence
            //	we will be screening out observed anyway.
            var observedRelevant = {};
            //Ancestors from node
            var ancestors = {};
            enumerateNodes(node, function (parent) {
                var parentName = parent.variable.name;
                allRelevant[parentName] = parent;
                if (parent.variable.valueIndex !== undefined) {
                    observedRelevant[parentName] = parent;
                    return false;
                }
                ancestors[parentName] = parent;
            }, false, true);
            //Connected to node, but not blocked by other observed (or an observed itself)
            var connectedObserved = {};
            enumerateNodes(node, function (connected, down) {
                if (connected.variable.valueIndex !== undefined) {
                    connectedObserved[connected.variable.name] = connected;
                    if (!down) {
                        return false;
                    }
                }
            });
            //Observed yield potential chains, but that are not relevant unless one is an ancestor of the target?
            var ancestorsChanged = true;
            while (ancestorsChanged) {
                ancestorsChanged = false;
                _.forEach(connectedObserved, function (observed, observedName) {
                    var observedAncestors = {};
                    observedAncestors[observedName] = observed;
                    var relevant = false;
                    enumerateNodes(observed, function (connected) {
                        var connectedName = connected.variable.name;
                        observedAncestors[connectedName] = connected;
                        if (connected.variable.valueIndex !== undefined)
                            return false;
                        if (ancestors[connectedName]) {
                            relevant = true;
                            return false;
                        }
                    }, false, true, true);
                    if (relevant) {
                        ancestorsChanged = true;
                        delete connectedObserved[observedName];
                        _.forEach(observedAncestors, function (x, y) {
                            ancestors[y] = x;
                            allRelevant[y] = x;
                        });
                    }
                });
            }
            delete allRelevant[node.variable.name];
            _.forEach(allRelevant, function (node, name) {
                node.isRelevant = true;
            });
        };
        Base.prototype.calculateChanceBruteForce = function (node) {
            var chance = calculate(node, this.data, this.nodeLookup);
            node.absoluteChance = chance;
        };
        Base.prototype.calculateChanceHeuristic = function (node) {
            console.log("Calculing heuristic for " + node.variable.name);
            /*
            console.time("Calc Relevant Brute Force");
            this.markRelevant(node);
            //Audit ourself, so we never mess up
            var relevantNodes: { [name: string]: boolean } = {};
            enumerateNodes(node, n => {
                if(n.isRelevant) {
                    relevantNodes[n.variable.name] = true;
                }
            });
            console.timeEnd("Calc Relevant Brute Force");
            */
            console.time("Calc Heuristic");
            this.markHeuristicRelevant(node);
            var relevant = [];
            var realRelevant = {};
            enumerateNodes(node, function (n) {
                if (n.isRelevant) {
                    relevant.push(n);
                    realRelevant[n.variable.name] = n;
                }
            });
            var chance = calculate(node, relevant, this.nodeLookup, true);
            node.absoluteChance = chance;
            console.timeEnd("Calc Heuristic");
            /*
            console.time("Audit Heuristic");
            _.forEach(realRelevant, (n, name) => {
                if(!relevantNodes[name]) {
                    debugger;
                    throw new Error("Incorrectly said " + name + " was relevant");
                }
            });
            _.forEach(relevantNodes, (k, name) => {
                if(!(name in realRelevant)) {
                    debugger;
                    throw new Error("Missed relevant " + name);
                }
            });
            console.timeEnd("Audit Heuristic");
            */
            /*
            console.time("Brute force calculate");
            var realChance = calculate(node, this.data, this.nodeLookup);
            console.timeEnd("Brute force calculate");
            
            if(!chanceEqual(chance, realChance)) {
                throw new Error("Heuristics provided wrong chance");
            }
            */
        };
        Base.prototype.calculateChance = function (node) {
            //Find nodes that are definitely not relevant
            //If there are nodes that have no set children, I am fairly sure 
        };
        Base.prototype.xPos = function (x) {
            return this.width(x - this.minX);
        };
        Base.prototype.width = function (w) {
            return w / ((this.maxX - this.minX) * (1 + this.nodeWidth));
        };
        Base.prototype.yPos = function (y) {
            return this.height(y - this.minY);
        };
        Base.prototype.height = function (h) {
            return h / ((this.maxY - this.minY) * (1 + this.nodeHeight));
        };
        Base.prototype.adjNodeWidth = function () {
            return this.nodeWidth / (1 + this.nodeWidth);
        };
        Base.prototype.adjNodeHeight = function () {
            return this.nodeHeight / (1 + this.nodeHeight);
        };
        Base.prototype.construct = function () {
            this.loadData(xml);
        };
        Base.prototype.loadData = function (xml) {
            var _this = this;
            this.data = parseData(xml);
            this.nodeLookup = {};
            this.data.forEach(function (node) {
                _this.nodeLookup[node.variable.name] = node;
            });
            this.minX = _.min(this.data.map(function (a) { return a.displayPos.x; }));
            this.minY = _.min(this.data.map(function (a) { return a.displayPos.y; }));
            this.maxX = _.max(this.data.map(function (a) { return a.displayPos.x; }));
            this.maxY = _.max(this.data.map(function (a) { return a.displayPos.y; }));
            this.safeApply();
        };
        Base.prototype.countKeys = function (obj) {
            var count = 0;
            for (var key in obj)
                count++;
            return count;
        };
        Base.prototype.max = function (obj, key) {
            var fnc = key && (function (k) { return k[key]; });
            return _.max(obj, fnc);
        };
        Base.prototype.min = function (obj, key) {
            var fnc = key && (function (k) { return k[key]; });
            return _.min(obj, fnc);
        };
        Base.prototype.isDefined = function (x) {
            return x !== undefined;
        };
        Base.prototype.mostRecent = function (obj, key, count) {
            var arr = _.map(obj, _.identity);
            arr.sort(function (a, b) {
                if (a[key] < b[key]) {
                    return -1;
                }
                else if (a[key] < b[key]) {
                    return +1;
                }
                return 0;
            });
        };
        Base.prototype.flatten = function (obj) {
            var arr = [];
            _.forEach(obj, function (x) { return _.forEach(x, function (k) { return arr.push(k); }); });
            return arr;
        };
        Base.prototype.select = function (obj, key) {
            return _.map(obj, function (x) { return x[key]; });
        };
        Base.prototype.getColor = function (text) {
            return hsl(hashCode(text) % 360, 75, 75);
        };
        Base.prototype.keys = function (obj) {
            return _.keys(obj);
        };
        return Base;
    })(Directive);
    var mod = angular.module("Base", ["FirebaseRead", "syncUrl", "SyncVariable", "objIntegrate", "FirebaseReadShallow"]);
    mod.directive("base", function () {
        return (new Base().createScope());
    });
    mod.filter('reverse', function () {
        return function (items) {
            return items.slice().reverse();
        };
    });
    mod.filter('sort', function () {
        return function (items) {
            items = items.slice();
            items.sort();
            return items;
        };
    });
    var arr = [];
    //Makes everything into properties, unless there are duplicates, then uses arrays. Arrays should
    //	just be explicit anyway, any format with implicit arrays is stupid (or any format with everything being
    //	arrays, just because it doesn't want to specify what is actually an array).
    function xmlIsDumb(obj, holder) {
        var childObj = {};
        obj.children.forEach(function (child) {
            xmlIsDumb(child, childObj);
        });
        if (obj.value) {
            childObj = obj.value;
        }
        if (obj.name in holder) {
            if (holder[obj.name].constructor !== arr.constructor) {
                holder[obj.name] = [holder[obj.name]];
            }
            holder[obj.name].push(childObj);
        }
        else {
            holder[obj.name] = childObj;
        }
        return holder;
    }
    function dumbXMLParser(xml, posIn) {
        var ret = { obj: { children: [] }, pos: posIn || 0 };
        //Start
        ret.pos = parseUntil(ret.pos, xml, "<");
        var nameStart = ret.pos + 1;
        //Name
        ret.pos = parseUntil(ret.pos, xml, new RegExp("( |>)"));
        var nameEnd = ret.pos;
        var name = xml.substring(nameStart, nameEnd);
        ret.obj.name = name;
        //Would parse properties here
        //Parse children
        ret.pos = parseUntil(ret.pos, xml, ">");
        if (xml[ret.pos - 1] === "/")
            return ret;
        var valueStart = ret.pos + 1;
        while (true) {
            ret.pos = parseUntil(ret.pos, xml, "<");
            //TODO: Actually check if it ends us (which would mean read the name of it)	
            if (xml[ret.pos + 1] === "/" || ret.pos >= xml.length) {
                if (ret.obj.children.length === 0) {
                    ret.obj.value = xml.substring(valueStart, ret.pos);
                }
                ret.pos++;
                return ret;
            }
            var result = dumbXMLParser(xml, ret.pos);
            ret.pos = result.pos;
            ret.obj.children.push(result.obj);
        }
        return ret;
    }
    var test = dumbXMLParser("\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<BIF VERSION=\"0.3\"  xmlns=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3\"\n\txmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n\txsi:schemaLocation=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd\">\n<NETWORK>\n<NAME>Conditional Independence Quiz</NAME>\n<PROPERTY>detailed = </PROPERTY>\n<PROPERTY>short = The conditional independence quiz is not intended to be a network used for querying, but is a graph useful for thinking about conditional independence questions.</PROPERTY>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>A</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7260.90625, 5272.43896484375)</PROPERTY>\n</VARIABLE>\n");
    console.log(test);
    window["parse"] = dumbXMLParser;
    var xml = "\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<BIF VERSION=\"0.3\"  xmlns=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3\"\n\txmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n\txsi:schemaLocation=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd\">\n<NETWORK>\n<NAME>Conditional Independence Quiz</NAME>\n<PROPERTY>detailed = </PROPERTY>\n<PROPERTY>short = The conditional independence quiz is not intended to be a network used for querying, but is a graph useful for thinking about conditional independence questions.</PROPERTY>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>A</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7260.90625, 5272.43896484375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>B</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7316.806640625, 5170.416015625)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>C</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7401.22900390625, 5048.64990234375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>D</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7392.3115234375, 5284.9638671875)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>E</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7468.1103515625, 5166.06396484375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>F</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7527.560546875, 5281.9912109375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>G</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7591.46923828125, 5166.06396484375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>H</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7659.83642578125, 5287.93603515625)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>I</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7588.49658203125, 5405.35009765625)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>J</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7740.09423828125, 5169.0361328125)</PROPERTY>\n</VARIABLE>\n\n<DEFINITION>\n\t<FOR>A</FOR>\n\t<GIVEN>B</GIVEN>\n\t<TABLE>0.7 0.3 0.4 0.6</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>B</FOR>\n\t<GIVEN>C</GIVEN>\n\t<TABLE>0.9 0.1 0.4 0.6</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>C</FOR>\n\t<TABLE>0.5 0.5</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>D</FOR>\n\t<GIVEN>B</GIVEN>\n\t<GIVEN>E</GIVEN>\n\t<TABLE>0.3 0.7 0.5 0.5 0.2 0.8 0.9 0.1</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>E</FOR>\n\t<GIVEN>C</GIVEN>\n\t<TABLE>0.7 0.3 0.2 0.8</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>F</FOR>\n\t<GIVEN>E</GIVEN>\n\t<GIVEN>G</GIVEN>\n\t<TABLE>0.9 0.1 0.2 0.8 0.4 0.6 0.7 0.3</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>G</FOR>\n\t<TABLE>0.2 0.8</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>H</FOR>\n\t<GIVEN>G</GIVEN>\n\t<GIVEN>J</GIVEN>\n\t<TABLE>0.8 0.2 0.3 0.7 0.5 0.5 0.1 0.9</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>I</FOR>\n\t<GIVEN>H</GIVEN>\n\t<TABLE>0.8 0.2 0.1 0.9</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>J</FOR>\n\t<TABLE>0.3 0.7</TABLE>\n</DEFINITION>\n</NETWORK>\n</BIF>\n";
    xml = "\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<BIF VERSION=\"0.3\"  xmlns=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3\"\n\txmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n\txsi:schemaLocation=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd\">\n<NETWORK>\n<NAME>Untitled</NAME>\n<PROPERTY>detailed = </PROPERTY>\n<PROPERTY>short = </PROPERTY>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 0</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7690.0, 5344.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 1</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7682.0, 5263.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 2</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7647.0, 5188.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 3</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7560.0, 5344.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 4</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7544.0, 5269.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 5</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7493.0, 5190.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 6</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7435.0, 5340.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 7</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7438.0, 5252.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Node 8</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7387.0, 5187.0)</PROPERTY>\n</VARIABLE>\n\n<DEFINITION>\n\t<FOR>Node 0</FOR>\n\t<GIVEN>Node 1</GIVEN>\n\t<TABLE>0.1 0.9 0.2 0.8</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Node 1</FOR>\n\t<GIVEN>Node 2</GIVEN>\n\t<TABLE>0.3 0.7 0.4 0.6</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Node 2</FOR>\n\t<TABLE>0.8 0.2</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Node 3</FOR>\n\t<GIVEN>Node 4</GIVEN>\n\t<TABLE>0.4 0.6 0.9 0.1</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Node 4</FOR>\n\t<GIVEN>Node 2</GIVEN>\n\t<GIVEN>Node 5</GIVEN>\n\t<TABLE>0.23 0.77 0.67 0.33 0.64 0.36 0.32 0.68</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Node 5</FOR>\n\t<TABLE>0.87 0.13</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Node 6</FOR>\n\t<GIVEN>Node 7</GIVEN>\n\t<TABLE>0.9 0.1 0.7 0.3</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Node 7</FOR>\n\t<GIVEN>Node 5</GIVEN>\n\t<GIVEN>Node 8</GIVEN>\n\t<TABLE>0.1 0.9 0.4 0.6 0.4 0.6 0.7 0.3</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Node 8</FOR>\n\t<TABLE>0.1 0.9</TABLE>\n</DEFINITION>\n</NETWORK>\n</BIF>\n\n";
    xml = "\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<BIF VERSION=\"0.3\"  xmlns=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3\"\n\txmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n\txsi:schemaLocation=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd\">\n<NETWORK>\n<NAME>Electrical Diagnosis Problem</NAME>\n<PROPERTY>detailed = This example models the problem of diagnosing the electrical system of a house. This is Figure 6.2 and Example 6.11 of Poole and Mackworth, Artificial Intelligence: foundations of computational agents. Copyright Poole and Mackworth, 2010. This may be used under a Creative Commons Attribution-Noncommercial-Share Alike 2.5 Canada License http://creativecommons.org/licenses/by-nc-sa/2.5/ca/</PROPERTY>\n<PROPERTY>short = Electrical Diagnosis Example of Poole and Mackworth, Artificial Intelligence.</PROPERTY>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>outside_power</NAME>\n\t<OUTCOME>on</OUTCOME>\n\t<OUTCOME>off</OUTCOME>\n\t<PROPERTY>position = (7611.4013671875, 5048.01123046875)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>cb1_st</NAME>\n\t<OUTCOME>on</OUTCOME>\n\t<OUTCOME>off</OUTCOME>\n\t<PROPERTY>position = (7428.17236328125, 5095.05615234375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>w3</NAME>\n\t<OUTCOME>live</OUTCOME>\n\t<OUTCOME>dead</OUTCOME>\n\t<PROPERTY>position = (7517.310546875, 5129.72119140625)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>cb2_st</NAME>\n\t<OUTCOME>on</OUTCOME>\n\t<OUTCOME>off</OUTCOME>\n\t<PROPERTY>position = (7716.63330078125, 5098.77001953125)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>w6</NAME>\n\t<OUTCOME>live</OUTCOME>\n\t<OUTCOME>dead</OUTCOME>\n\t<PROPERTY>position = (7639.87548828125, 5156.95751953125)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>p2</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7693.10986328125, 5259.7138671875)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>p1</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7589.11669921875, 5256.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>s1_st</NAME>\n\t<OUTCOME>ok</OUTCOME>\n\t<OUTCOME>upside_down</OUTCOME>\n\t<OUTCOME>short</OUTCOME>\n\t<OUTCOME>intermittent</OUTCOME>\n\t<OUTCOME>broken</OUTCOME>\n\t<PROPERTY>position = (7445.5048828125, 5184.1943359375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>s1_pos</NAME>\n\t<OUTCOME>up</OUTCOME>\n\t<OUTCOME>down</OUTCOME>\n\t<PROPERTY>position = (7362.556640625, 5186.669921875)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>w1</NAME>\n\t<OUTCOME>live</OUTCOME>\n\t<OUTCOME>dead</OUTCOME>\n\t<PROPERTY>position = (7400.9365234375, 5267.14208984375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>w2</NAME>\n\t<OUTCOME>live</OUTCOME>\n\t<OUTCOME>dead</OUTCOME>\n\t<PROPERTY>position = (7487.59765625, 5264.66650390625)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>w0</NAME>\n\t<OUTCOME>live</OUTCOME>\n\t<OUTCOME>dead</OUTCOME>\n\t<PROPERTY>position = (7446.7431640625, 5355.04248046875)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>s2_st</NAME>\n\t<OUTCOME>ok</OUTCOME>\n\t<OUTCOME>upside_down</OUTCOME>\n\t<OUTCOME>short</OUTCOME>\n\t<OUTCOME>intermittent</OUTCOME>\n\t<OUTCOME>broken</OUTCOME>\n\t<PROPERTY>position = (7357.60498046875, 5315.42529296875)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>s2_pos</NAME>\n\t<OUTCOME>up</OUTCOME>\n\t<OUTCOME>down</OUTCOME>\n\t<PROPERTY>position = (7356.36669921875, 5382.27880859375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>l1_lit</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7461.59912109375, 5463.98828125)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>w4</NAME>\n\t<OUTCOME>live</OUTCOME>\n\t<OUTCOME>dead</OUTCOME>\n\t<PROPERTY>position = (7575.49853515625, 5347.6142578125)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>s3_pos</NAME>\n\t<OUTCOME>up</OUTCOME>\n\t<OUTCOME>down</OUTCOME>\n\t<PROPERTY>position = (7620.0673828125, 5303.04541015625)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>s3_st</NAME>\n\t<OUTCOME>ok</OUTCOME>\n\t<OUTCOME>upside_down</OUTCOME>\n\t<OUTCOME>short</OUTCOME>\n\t<OUTCOME>intermittent</OUTCOME>\n\t<OUTCOME>broken</OUTCOME>\n\t<PROPERTY>position = (7699.30078125, 5350.09033203125)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>l2_lit</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7613.876953125, 5451.6083984375)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>l2_st</NAME>\n\t<OUTCOME>ok</OUTCOME>\n\t<OUTCOME>intermittent</OUTCOME>\n\t<OUTCOME>broken</OUTCOME>\n\t<PROPERTY>position = (7693.10986328125, 5414.46728515625)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>l1_st</NAME>\n\t<OUTCOME>ok</OUTCOME>\n\t<OUTCOME>intermittent</OUTCOME>\n\t<OUTCOME>broken</OUTCOME>\n\t<PROPERTY>position = (7524.73876953125, 5415.70556640625)</PROPERTY>\n</VARIABLE>\n\n<DEFINITION>\n\t<FOR>outside_power</FOR>\n\t<TABLE>0.98 0.02</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>cb1_st</FOR>\n\t<TABLE>0.999 0.001</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>w3</FOR>\n\t<GIVEN>outside_power</GIVEN>\n\t<GIVEN>cb1_st</GIVEN>\n\t<TABLE>1.0 0.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>cb2_st</FOR>\n\t<TABLE>0.999 0.001</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>w6</FOR>\n\t<GIVEN>outside_power</GIVEN>\n\t<GIVEN>cb2_st</GIVEN>\n\t<TABLE>1.0 0.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>p2</FOR>\n\t<GIVEN>w6</GIVEN>\n\t<TABLE>1.0 0.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>p1</FOR>\n\t<GIVEN>w3</GIVEN>\n\t<TABLE>1.0 0.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>s1_st</FOR>\n\t<TABLE>0.9 0.01 0.04 0.03 0.02</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>s1_pos</FOR>\n\t<TABLE>0.5 0.5</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>w1</FOR>\n\t<GIVEN>w3</GIVEN>\n\t<GIVEN>s1_st</GIVEN>\n\t<GIVEN>s1_pos</GIVEN>\n\t<TABLE>1.0 0.0 0.0 1.0 0.0 1.0 1.0 0.0 0.6 0.4 0.4 0.6 0.4 0.6 0.01 0.99 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>w2</FOR>\n\t<GIVEN>w3</GIVEN>\n\t<GIVEN>s1_st</GIVEN>\n\t<GIVEN>s1_pos</GIVEN>\n\t<TABLE>0.0 1.0 1.0 0.0 1.0 0.0 0.0 1.0 0.4 0.6 0.4 0.6 0.2 0.8 0.2 0.8 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>w0</FOR>\n\t<GIVEN>w1</GIVEN>\n\t<GIVEN>w2</GIVEN>\n\t<GIVEN>s2_st</GIVEN>\n\t<GIVEN>s2_pos</GIVEN>\n\t<TABLE>1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 0.8 0.2 0.8 0.2 0.4 0.6 0.4 0.6 0.0 1.0 0.0 1.0 1.0 0.0 0.0 1.0 0.0 1.0 1.0 0.0 0.4 0.6 0.4 0.6 0.2 0.8 0.2 0.8 0.0 1.0 0.0 1.0 0.0 1.0 1.0 0.0 1.0 0.0 0.0 1.0 0.4 0.6 0.4 0.6 0.2 0.8 0.2 0.8 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>s2_st</FOR>\n\t<TABLE>0.9 0.01 0.04 0.03 0.02</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>s2_pos</FOR>\n\t<TABLE>0.5 0.5</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>l1_lit</FOR>\n\t<GIVEN>w0</GIVEN>\n\t<GIVEN>l1_st</GIVEN>\n\t<TABLE>1.0 0.0 0.7 0.3 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>w4</FOR>\n\t<GIVEN>w3</GIVEN>\n\t<GIVEN>s3_pos</GIVEN>\n\t<GIVEN>s3_st</GIVEN>\n\t<TABLE>1.0 0.0 0.0 1.0 0.4 0.6 0.2 0.8 0.0 1.0 0.0 1.0 1.0 0.0 0.4 0.6 0.2 0.8 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>s3_pos</FOR>\n\t<TABLE>0.8 0.2</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>s3_st</FOR>\n\t<TABLE>0.9 0.01 0.04 0.03 0.02</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>l2_lit</FOR>\n\t<GIVEN>w4</GIVEN>\n\t<GIVEN>l2_st</GIVEN>\n\t<TABLE>1.0 0.0 0.6 0.4 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>l2_st</FOR>\n\t<TABLE>0.9 0.03 0.07</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>l1_st</FOR>\n\t<TABLE>0.9 0.07 0.03</TABLE>\n</DEFINITION>\n</NETWORK>\n</BIF>\n";
    xml = "\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<BIF VERSION=\"0.3\"  xmlns=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3\"\n\txmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n\txsi:schemaLocation=\"http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd\">\n<NETWORK>\n<NAME>Untitled</NAME>\n<PROPERTY>detailed = </PROPERTY>\n<PROPERTY>short = </PROPERTY>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Traveling</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7273.0, 5050.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Foreign Purchase</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7237.0, 5153.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Fraud</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7421.0, 5102.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Internet</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7542.0, 5175.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Owns Computer</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7655.0, 5050.0)</PROPERTY>\n</VARIABLE>\n\n<VARIABLE TYPE=\"nature\">\n\t<NAME>Has Computer Purchase</NAME>\n\t<OUTCOME>T</OUTCOME>\n\t<OUTCOME>F</OUTCOME>\n\t<PROPERTY>position = (7752.0, 5197.0)</PROPERTY>\n</VARIABLE>\n\n<DEFINITION>\n\t<FOR>Traveling</FOR>\n\t<TABLE>0.05 0.95</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Foreign Purchase</FOR>\n\t<GIVEN>Traveling</GIVEN>\n\t<GIVEN>Fraud</GIVEN>\n\t<TABLE>0.9 0.1 0.9 0.1 0.1 0.9 0.01 0.99</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Fraud</FOR>\n\t<GIVEN>Traveling</GIVEN>\n\t<TABLE>0.01 0.99 0.004 0.996</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Internet</FOR>\n\t<GIVEN>Fraud</GIVEN>\n\t<GIVEN>Owns Computer</GIVEN>\n\t<TABLE>0.02 0.98 0.011 0.989 0.01 0.99 0.001 0.999</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Owns Computer</FOR>\n\t<TABLE>0.6 0.4</TABLE>\n</DEFINITION>\n\n<DEFINITION>\n\t<FOR>Has Computer Purchase</FOR>\n\t<GIVEN>Owns Computer</GIVEN>\n\t<TABLE>0.1 0.9 0.001 0.999</TABLE>\n</DEFINITION>\n</NETWORK>\n</BIF>\n\n";
});
