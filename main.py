class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next


myList = [1,2]

dummyNode = Node(3) #+
currPointer = dummyNode# -
#  +             -
# (3) -> (1) -> (2)
for i in range(len(myList)):
    currPointer.next = Node(myList[i])
    currPointer= currPointer.next

dummyNode.next
    


